"use strict"

var Koa = require('koa'),
  _ = require('koa-route'),
  co = require('co'),
  views = require('co-views'),
  convert = require('koa-convert'),
  serve = require('koa-static'),
  MongoClient = require('mongodb').MongoClient;

// Simple test connection
var url = 'mongodb://localhost:27017/npmintel';

// Setting up views
var render = views(__dirname + '/views', { ext: 'ejs' });

// The KOA application
var app = new Koa();

// Add the static route allowing us to access any assets
app.use(convert(serve(__dirname + '/public')));

// Router
var router = require('koa-router')();

// Main index page
var main = function(title, db) {
  return function(ctx, next) {
    return new Promise(function(resolve, reject) {
      co(function*() {
        // Render the main template
        var body = yield render('main', {});
        ctx.body = yield render('layout', {title:title, body: body});

        // Resolve
        resolve();
      });
    });
  }
}

// Var application title
var title = 'NPM statistics application';

// Co function
co(function*(){
  // Get a connection
  var db = yield MongoClient.connect(url);

  // Add a router entry
  router.get('/', main(title, db));

  // Add routes
  app
    .use(router.routes())
    .use(router.allowedMethods());

  // Listen to port
  if (!module.parent) app.listen(3000);
}).catch(function(err) {
  console.log(err.stack);
});
