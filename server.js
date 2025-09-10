const express = require("express");
const axios = require("axios");
const cheerio = require('cheerio');
const path = require('path');
const { URL } = require('url');

const app = express();
const port = 3000;

// Body parsing middleware (must be before routes)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Serve index.html from the current directory for the home route
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// Proxy all HTTP methods for /sites/{*url}
app.all("/sites/{*url}", async (req, res) => {
    // Access the named wildcard parameter
    const encodedFullUrl = req.params.url;

    if (!encodedFullUrl) {
        return res.status(400).send("Bad Request: Missing URL parameter.");
    }

    let fullUrl = decodeURIComponent(encodedFullUrl);
    
    if (!/^https?:\/\/.+/i.test(fullUrl)) {
        return res.status(400).send("Please provide a full URL (with http:// or https://)");
    }

    try {
        // Remove host and content-length headers
        const filteredHeaders = { ...req.headers };
        delete filteredHeaders.host;
        delete filteredHeaders['content-length'];

        // Forward cookies
        if (req.headers.cookie) {
            filteredHeaders.cookie = req.headers.cookie;
        }

        // Forward query string
        const queryString = req.originalUrl.split('?')[1] ? '?' + req.originalUrl.split('?')[1] : '';
        const axiosConfig = {
            url: fullUrl + queryString,
            method: req.method,
            headers: filteredHeaders,
            data: req.body,
            responseType: "text",
            maxRedirects: 0,
            validateStatus: status => status >= 200 && status < 400
        };
        const response = await axios(axiosConfig);
        let data = response.data;
        const contentType = response.headers['content-type'] || '';
        const baseUrl = new URL(fullUrl);
        // Handle HTTP redirects (3xx)
        if (response.status >= 300 && response.status < 400 && response.headers.location) {
            let location = response.headers.location;
            // Always resolve to absolute URL
            try {
                location = new URL(location, baseUrl).href;
            } catch (err) {
                // If location is already absolute, use as is
            }
            if (!/^https?:\/\//i.test(location)) {
                // If still not absolute, prepend protocol and host
                location = baseUrl.origin + location;
            }
            return res.redirect(`/sites/${encodeURIComponent(location)}`);
        }
        // Remove security headers that block embedding/proxying
        res.removeHeader('Content-Security-Policy');
        res.removeHeader('X-Frame-Options');
        res.removeHeader('Access-Control-Allow-Origin');
        res.removeHeader('Access-Control-Allow-Headers');
        // Forward set-cookie headers
        if (response.headers['set-cookie']) {
            res.set('Set-Cookie', response.headers['set-cookie']);
        }
        if (contentType.includes('text/html')) {
            const $ = cheerio.load(data);
            function rewriteAsset(selector, attr) {
                $(selector).each(function() {
                    let assetUrl = $(this).attr(attr);
                    if (!assetUrl || assetUrl.startsWith('data:') || assetUrl.startsWith('mailto:') || assetUrl.startsWith('javascript:')) return;
                    if (assetUrl.startsWith('//')) {
                        assetUrl = `${baseUrl.protocol}${assetUrl}`;
                    }
                    try {
                        const resolvedAssetUrl = new URL(assetUrl, baseUrl).href;
                        $(this).attr(attr, `/sites/${encodeURIComponent(resolvedAssetUrl)}`);
                    } catch (err) {
                        console.error(`${attr} URL resolution error:`, err.message);
                    }
                });
            }
            // Remove meta CSP and X-Frame-Options
            $('meta[http-equiv="Content-Security-Policy"]').remove();
            $('meta[http-equiv="X-Frame-Options"]').remove();
            // Rewrite assets
            rewriteAsset('a[href]', 'href');
            rewriteAsset('form[action]', 'action');
            rewriteAsset('link[href]', 'href');
            rewriteAsset('script[src]', 'src');
            rewriteAsset('img[src]', 'src');
            rewriteAsset('iframe[src]', 'src');
            rewriteAsset('source[src]', 'src');
            rewriteAsset('video[src]', 'src');
            rewriteAsset('audio[src]', 'src');
            rewriteAsset('embed[src]', 'src');
            rewriteAsset('object[data]', 'data');
            $('base').remove();
            data = $.html();
        }
        res.set('content-type', contentType);
        res.send(data);
    } catch (error) {
        if (error.response && error.response.status >= 300 && error.response.status < 400 && error.response.headers.location) {
            let location = error.response.headers.location;
            try {
                location = new URL(location, fullUrl).href;
            } catch (err) {
                // If location is already absolute, use as is
            }
            if (!/^https?:\/\//i.test(location)) {
                location = new URL(location, fullUrl).origin + location;
            }
            return res.redirect(`/sites/${encodeURIComponent(location)}`);
        }
        res.status(500).send(`Error occurred: ${error.message}`);
    }
});

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
    console.log('Test with URLs like:');
    console.log('  http://localhost:3000/sites/https%3A%2F%2Fexample.com');
    console.log('  http://localhost:3000/sites/https%3A%2F%2Fexample.com%2Fabout');
});
