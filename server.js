var http = require('http');
var https = require('https');
var config = require("./config");
var url = require("url");
var request = require("request");
var cluster = require('cluster');
var ssrfGuard = require('./ssrf-guard');
var throttle = require("tokenthrottle")({rate: config.max_requests_per_second});

http.globalAgent.maxSockets = Infinity;
https.globalAgent.maxSockets = Infinity;

var publicAddressFinder = require("public-address");
var publicIP;

// Get our public IP address
publicAddressFinder(function (err, data) {
    if (!err && data) {
        publicIP = data.address;
    }
});

function addCORSHeaders(req, res) {
    if (req.method.toUpperCase() === "OPTIONS") {
        if (req.headers["access-control-request-headers"]) {
            res.setHeader("Access-Control-Allow-Headers", req.headers["access-control-request-headers"]);
        }

        if (req.headers["access-control-request-method"]) {
            res.setHeader("Access-Control-Allow-Methods", req.headers["access-control-request-method"]);
        }
    }

    if (req.headers["origin"]) {
        res.setHeader("Access-Control-Allow-Origin", req.headers["origin"]);
    }
    else {
        res.setHeader("Access-Control-Allow-Origin", "*");
    }
}

function writeResponse(res, httpCode, body) {
    if (!res.headersSent) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('X-Content-Type-Options', 'nosniff');
    }
    res.statusCode = httpCode;
    res.end(body);
}

function sendInvalidURLResponse(res) {
    return writeResponse(res, 404, "url must be in the form of /fetch/{some_url_here}");
}

function sendTooBigResponse(res) {
    return writeResponse(res, 413, "the content in the request or response cannot exceed " + config.max_request_length + " characters.");
}

function getClientAddress(req) {
    // Never key throttling on a client-supplied X-Forwarded-For: there is no
    // trusted proxy in front of this server, so a client could pick its own
    // rate-limit bucket and defeat the limit entirely.
    return (req.socket && req.socket.remoteAddress)
        || (req.connection && req.connection.remoteAddress)
        || 'unknown';
}

function processRequest(req, res) {
    addCORSHeaders(req, res);

    // Return options pre-flight requests right away
    if (req.method.toUpperCase() === "OPTIONS") {
        return writeResponse(res, 204);
    }

    var result = config.fetch_regex.exec(req.url);

    if (result && result.length == 2 && result[1]) {
        var remoteURL;

        try {
            remoteURL = url.parse(decodeURI(result[1]));
        }
        catch (e) {
            return sendInvalidURLResponse(res);
        }

        // We don't support relative links
        if (!remoteURL.host) {
            return writeResponse(res, 404, "relative URLS are not supported");
        }

        // Destination validation is enforced at connect time by ssrf-guard.js:
        // the hostname is resolved, every answer is checked against private,
        // loopback, link-local, ULA and metadata ranges, and the connection is
        // pinned to the address that was checked. A string prefix regex is not
        // enough (169.254.169.254, 172.16/12, IPv6, DNS rebinding, "localhost.").

        // We only support http and https
        if (remoteURL.protocol != "http:" && remoteURL.protocol !== "https:") {
            return writeResponse(res, 400, "only http and https are supported");
        }

        if (publicIP) {
            // Add an X-Forwarded-For header
            if (req.headers["x-forwarded-for"]) {
                req.headers["x-forwarded-for"] += ", " + publicIP;
            }
            else {
                req.headers["x-forwarded-for"] = req.clientIP + ", " + publicIP;
            }
        }

        // Make sure the host header is to the URL we're requesting, not thingproxy
        if (req.headers["host"]) {
            req.headers["host"] = remoteURL.host;
        }
        
        // Remove origin and referer headers. TODO: This is a bit naughty, we should remove at some point.
        delete req.headers["origin"];
        delete req.headers["referer"];

        // Strip hop-by-hop headers (RFC 7230 6.1) and anything named in
        // Connection; forwarding them lets the client desync the upstream.
        var HOP_BY_HOP = [
            'connection', 'keep-alive', 'proxy-authenticate',
            'proxy-authorization', 'te', 'trailer', 'transfer-encoding',
            'upgrade', 'proxy-connection'
        ];
        HOP_BY_HOP.forEach(function (header) {
            delete req.headers[header];
        });

        var proxyRequest = request({
            url: remoteURL,
            headers: req.headers,
            method: req.method,
            timeout: config.proxy_request_timeout_ms,
            strictSSL: true,
            followRedirect: false,
            lookup: ssrfGuard.safeLookup
        });

        proxyRequest.on('error', function (err) {

            if (err.code === 'ESSRF') {
                return writeResponse(res, 403, "destination host is not allowed");
            }
            if (err.code === "ENOTFOUND") {
                return writeResponse(res, 502, "Host for " + url.format(remoteURL) + " cannot be found.")
            }
            else {
                console.log("Proxy Request Error (" + url.format(remoteURL) + "): " + err.toString());
                return writeResponse(res, 500);
            }

        });

        // Count bytes on the source streams. pipe() returns the destination,
        // and the previous code attached the counters to the wrong objects,
        // so neither limit ever fired.
        var requestSize = 0;
        req.on('data', function (data) {
            requestSize += data.length;
            if (requestSize > config.max_request_length) {
                proxyRequest.abort();
                res.destroy();
            }
        });
        req.pipe(proxyRequest);

        var proxyResponseSize = 0;
        proxyRequest.on('data', function (data) {
            proxyResponseSize += data.length;
            if (proxyResponseSize > config.max_request_length) {
                proxyRequest.abort();
                res.destroy();
            }
        });
        proxyRequest.pipe(res);
    }
    else {
        return sendInvalidURLResponse(res);
    }
}

if (cluster.isMaster) {
    for (var i = 0; i < config.cluster_process_count; i++) {
        cluster.fork();
    }
}
else
{
    http.createServer(function (req, res) {

        // Process AWS health checks
        if (req.url === "/health") {
            return writeResponse(res, 200);
        }

        var clientIP = getClientAddress(req);

        req.clientIP = clientIP;

        // Log our request
        if (config.enable_logging) {
            console.log("%s %s %s", (new Date()).toJSON(), clientIP, req.method, req.url);
        }

        if (config.enable_rate_limiting) {
            throttle.rateLimit(clientIP, function (err, limited) {
                if (limited) {
                    return writeResponse(res, 429, "enhance your calm");
                }

                processRequest(req, res);
            })
        }
        else {
            processRequest(req, res);
        }

    }).listen(config.port);

    console.log("thingproxy.freeboard.io process started (PID " + process.pid + ")");
}
