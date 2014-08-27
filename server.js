var http = require('http');
var config = require("./config");
var url = require("url");
var request = require("request");
var throttle = require("tokenthrottle")({rate: config.max_requests_per_second});

function addCORSHeaders(res)
{
	res.setHeader("Access-Control-Allow-Origin", "*");
}

function writeResponse(res, httpCode, body) {
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
	return (req.headers['x-forwarded-for'] || '').split(',')[0]
		|| req.connection.remoteAddress;
}

function processRequest(req, res)
{
	addCORSHeaders(res);

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
		if(!remoteURL.host)
		{
			return writeResponse(res, 404, "relative URLS are not supported");
		}

		// We only support http and https
		if (remoteURL.protocol != "http:" && remoteURL.protocol !== "https:") {
			return writeResponse(res, 400, "only http and https are supported");
		}

		var proxyRequest = request({
			url: remoteURL,
			headers: req.headers,
			method: req.method,
			timeout: config.proxy_request_timeout_ms,
			strictSSL : false
		});

		proxyRequest.on('error', function(err){

			if(err.code === "ENOTFOUND")
			{
				return writeResponse(res, 502, "host cannot be found.")
			}
			else
			{
				return writeResponse(res, 500);
			}

		});

		var requestSize = 0;
		var proxyResponseSize = 0;

		req.pipe(proxyRequest).on('data', function(data){

			requestSize += data.length;

			if(requestSize >= config.max_request_length)
			{
				proxyRequest.end();
				return sendTooBigResponse(res);
			}
		});

		proxyRequest.pipe(res).on('data', function (data) {

			proxyResponseSize += data.length;

			if(proxyResponseSize >= config.max_request_length)
			{
				proxyRequest.end();
				return sendTooBigResponse(res);
			}
		});
	}
	else {
		return sendInvalidURLResponse(res);
	}
}

http.createServer(function (req, res) {

	// Process AWS health checks
	if(req.url === "/health")
	{
		return writeResponse(res, 200);
	}

	var remoteIP = getClientAddress(req);

	// Log our request
	if(config.enable_logging)
	{
		console.log("%s %s %s", (new Date()).toJSON(), remoteIP, req.method, req.url);
	}

	if(config.enable_rate_limiting)
	{
		throttle.rateLimit(remoteIP, function(err, limited) {
			if (limited)
			{
				return writeResponse(res, 429, "enhance your calm");
			}

			processRequest(req, res);
		})
	}
	else
	{
		processRequest(req, res);
	}

}).listen(config.port);

console.log("thingproxy.freeboard.io started");
