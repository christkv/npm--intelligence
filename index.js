"use strict"

var Koa = require('koa'),
  _ = require('koa-route'),
  co = require('co'),
  views = require('co-views'),
  convert = require('koa-convert'),
  moment = require('moment'),
  bodyParser = require('koa-bodyparser'),
  f = require('util').format,
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
// Add a body parser
app.use(convert(bodyParser()));

// Router
var router = require('koa-router')();

// Main index page
var main = function(title, db) {
  return function(ctx, next) {
    return new Promise(function(resolve, reject) {
      co(function*() {
        // Fetch all dependency downloads, sort by the total download stats
        var modules = yield db.collection('downloads')
          .find({})
          .project({'name':1, 'stats.total':1, 'stats.perYears':1})
          .sort({'stats.total':-1}).limit(50).toArray();

        // Render the main template
        var body = yield render('main', {
          modules: modules
        });

        ctx.body = yield render('layout', {
          title: title,
          body: body,
          active: "Main"
        });

        // Resolve
        resolve();
      }).catch(reject);
    });
  }
}

var singleBarGraphRender = function(div, labels, series) {
  // The bar graph code
  var barGraphCode = function(div, labels, series) {
    var data = {
      labels: labels,
      series: [
        series
      ]
    };

    var options = {
      seriesBarDistance: 2
    };

    var responsiveOptions = [
      ['screen and (max-width: 640px)', {
        seriesBarDistance: 5,
        axisX: {
          labelInterpolationFnc: function (value) {
            return value[0];
          }
        }
      }]
    ];

    new Chartist.Bar(div, data, options, responsiveOptions);
  }

  // Generate the template string that is passed to the browser
  var template = `
    <script>
      var _graph = ${barGraphCode.toString()};
      _graph("${div}", ${JSON.stringify(labels)}, ${JSON.stringify(series)});
    </script>
  `
  return template;
}

var module_view = function(title, db) {
  return function(ctx, next) {
    return new Promise(function(resolve, reject) {
      co(function*() {
        // Grab the module
        var npmModule = ctx.params.module;
        // Get module, download stats and dependents in parallel
        var results = yield Promise.all([
          db.collection('modules').findOne({
            name: npmModule
          }),
          db.collection('downloads').findOne({
            name: npmModule
          }),
          db.collection('dependents').findOne({
            name: npmModule
          }),
        ]);

        // Build the arrays
        var labels = [];
        var values = [];
        var dependentsByName = [];

        // Do we have any dependents for this module
        if(results[2]) {
          // Fetch all dependency downloads, sort by the total download stats
          dependentsByName = yield db.collection('downloads').find({
            name: {
              $in: results[2].dependents
            }
          }).project({'name':1, 'stats.total':1, 'stats.perYears':1}).sort({'stats.total':-1}).toArray();
        }

        // Generate the values
        results[1].stats.perMonth.reverse().forEach(function(x) {
          var date = moment(x.start);
          labels.push(date.format("M/YY"));
          values.push(x.value);
        });

        // Render the main template
        var body = yield render('module', {
          bar_graph: singleBarGraphRender('#ct-chart', labels, values),
          name: npmModule,
          module: results[0],
          dependentsByName: dependentsByName,
          moment: moment
        });

        // Render the final module
        ctx.body = yield render('layout', {
          title:title,
          body: body,
          active: "Overview"
        });

        // Resolve
        resolve();
      }).catch(reject);
    });
  }
}

var module_search = function(title, db) {
  return function(ctx, next) {
    return new Promise(function(resolve, reject) {
      co(function*() {
        // Locate any modules by search
        var modules = yield db.collection('modules').find({
          name: {
            $regex: ctx.request.body.search || ''
          }
        }).toArray();

        // Render the main template
        var body = yield render('search', {
          modules: modules,
          moment: moment
        });

        // Render the final module
        ctx.body = yield render('layout', {
          title:title,
          body: body,
          active: "Search"
        });
        // Resolve
        resolve();
      }).catch(reject);
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
  router.get('/module/:module', module_view(title, db));
  router.post('/module/search', module_search(title, db));

  // Add routes
  app
    .use(router.routes())
    .use(router.allowedMethods());

  // Listen to port
  if (!module.parent) app.listen(3000);
}).catch(function(err) {
  console.log(err.stack);
  process.exit(0);
});
