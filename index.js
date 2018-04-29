var express = require("express");
var path = require('path');
var bodyParser = require("body-parser");
var mongodb = require("mongodb");
var ObjectID = mongodb.ObjectID;
var request = require("request");
var http = require("http");
var app = express();
var fs = require('fs');

var COLLECTION = "url_shortener";
var COUNTER = "counter";

app.use(bodyParser.json());
app.use(express.static( path.join(__dirname, 'public')));

// Create a database variable outside of the database connection callback to reuse the connection pool in app.
var db;

// Connect to the database before starting the application server.
mongodb.MongoClient.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/url_shortener", function(err, client) {
    if (err) {
        console.log(err);
        process.exit(1);
    }

    // Save database object from the callback for reuse.
    db = client.db();
    console.log("Database connection ready");

    // Initialize the app.
    var server = app.listen(process.env.PORT || 8080, function() {
        var port = server.address().port;
        console.log("Url shortener listening on port", port);
    });
});

// Find and increment the next id in mongo.
function getNextShortUrlId(callback) {
    // find and increment the number for the new short url.
    db.collection(COUNTER).findAndModify({
            counterId: "UrlCounterId"
        }, [], {
            $inc: {
                urlId: 1
            }
        }, {
            upsert: true,
            new: true
        },
        function(err, newIdDoc) {
            callback(err ? undefined : newIdDoc.value.urlId);
        }
    );
}

// Shortify the url : 
// - Get the next id
// - Create an obj with both, short and original url
// - store this obj in mongo collection.
function shortify(host, res, url) {
    // Get the next Id
    getNextShortUrlId(function(newId) {
        if (newId) {
            // Create a "Short Url Object" -> the url with its short url.
            var shortUrlObj = {
                original_url: url,
                short_url: host + '/' + newId
            };

            db.collection(COLLECTION).insertOne(shortUrlObj, function(err, result) {
                if (err) {
                    res.status(200).json({
                        error: "Can't create a short url, database issue"
                    });
                } else {
                    // remove the ID field for user response.
                    delete shortUrlObj._id;
                    res.status(200).json(shortUrlObj);
                }
            });
        } else {
            // Can't find a new ID in mongo
            res.status(200).json({
                error: "Can't create a short url, database issue"
            });
        }
    });
}

// Route for index.
app.get('/', function(req, res) {
    res.render('index.html');
});

// Route for shortification request (ie : http://host/short/http://www.google.fr)
app.get("/short/:protocol://:url", function(req, res) {
    var url = req.params.protocol + "://" + req.params.url;
    // Check if the url is valid (real website)
    request(url, function(error, response, body) {
        var result;
        if (!error && response.statusCode == 200) {
            // Good url -> store the short url in mongo
            shortify(req.headers.host, res, url);
        } else {
            // Bad url
            res.status(200).json({
                error: "Wrong url format, make sure you have a valid protocol and real site."
            });
        }
    });
});

// Route for short url access (ie : http://host/1234)
app.get('/:shortUrl(\\d+)', function(req, res) {
    db.collection(COLLECTION).findOne({
        short_url: req.headers.host + '/' + req.params.shortUrl
    }, {
        _id: 0
    }, function(err, shortUrlObj) {
        if (err) {
            res.status(200).json({
                error: "Database read error."
            });
        } else {
            if (shortUrlObj) {
                // redirect to the registered url.
                res.writeHead(301, {
                    "Location": shortUrlObj.original_url
                });
                res.end();
            } else {
                res.status(200).json({
                    error: "This short url is not in the database."
                });
            }
        }
    });
});

app.use(function(req, res) {
    res.status(404).end('This url is not allowed ;)');
});