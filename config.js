exports.port = process.env.PORT || 3000;
exports.enable_logging = false;
exports.fetch_regex = /^\/fetch\/(.*)$/; // The URL to look for when parsing the request.
exports.proxy_request_timeout_ms = 10000; // The lenght of time we'll wait for a proxy server to respond before timing out.
exports.max_request_length = 100000; // The maximum length of characters allowed for a request or a response.
exports.enable_rate_limiting = true;
exports.max_requests_per_second = 10; // The maximum number of requests per second to allow from a given IP.
// Destination filtering lives in ssrf-guard.js. A hostname regex cannot cover
// 169.254.169.254, 172.16/12, IPv6, DNS rebinding or "localhost." with a dot.
exports.cluster_process_count = Number(process.env.CLUSTER_PROCESS_COUNT) || require("os").cpus().length;