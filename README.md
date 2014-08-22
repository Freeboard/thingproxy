thingproxy
==========

A simple forward proxy server for processing API calls to servers that don't send CORS headers or support HTTPS.

### what?

thingproxy allows javascript code on your site to access resources on other domains that would normally be blocked due to the [same-origin policy](http://en.wikipedia.org/wiki/Same_origin_policy). It acts as a proxy between your browser and a remote server and adds the proper CORS headers to the response.

In addition, some browsers don't allow requests for non-encrypted HTTP data if the page itself is loaded from HTTPS. thingproxy can call nonthingproxy also allows you to access non-secure HTTP API's from a secure HTTPS url. 

While you can run your own thingproxy server with this source code, but freeboard.io offers a free proxy available at:

http://thingproxy.freeboard.io and https://thingproxy.freeboard.io

### why?

Dashboards created with freeboard normally access APIs directly from ajax calls from javascript. Many API providers do not provide the proper CORS headers, or don't support HTTPS— thing proxy is provided to overcome these limitations.

### how?

Just call the url with the form:

```
http(s)://thingproxy.freeboard.io/fetch/<my_api_url>
```

For example:

```
https://thingproxy.freeboard.io/fetch/http://my.api.com/get/stuff
```

Any HTTP method, headers and body you send, will be sent to the URL you specify and the response will be sent back to you with the proper CORS headers attached.

### caveats

Don't abuse the thingproxy.freeboard.io server— it is meant for relatively small API calls and not as a proxy server to hide your identity. Right now we limit requests and responses to 100,000 characters each (sorry no file downloads), and throttle each IP to 10 requests/second.

### privacy

thingproxy.freeboard.io does log the date, requester's IP address, and URL for each request sent to it. We will not share or sell this data to anyone period.
