"use strict"

var Koa = require('koa'),
  _ = require('koa-route'),
  co = require('co'),
  views = require('co-views'),
  session = require('koa-session'),
  convert = require('koa-convert'),
  moment = require('moment'),
  url = require('url'),
  bodyParser = require('koa-bodyparser'),
  f = require('util').format,
  serve = require('koa-static'),
  MongoClient = require('mongodb').MongoClient;

// Simple test connection
var uri = 'mongodb://localhost:27017/npmintel';

// Setting up views
var render = views(__dirname + '/views', { ext: 'ejs' });

// The KOA application
var app = new Koa();

// required for signed cookie sessions
app.keys = ['sillykey1', 'sillykey2'];
app.use(convert(session(app)));

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
          .project({
            'name':1,
            'stats.total':1,
            'stats.last30days':1,
            'stats.perYears':1
          })
          .sort({'stats.last30days':-1}).limit(50).toArray();

        // Render the main template
        var body = yield render('main', {
          modules: modules
        });

        ctx.body = yield render('layout', {
          title: title, body: body, menu: [
            {name: 'Main', active:true},
            {name: 'Compare', href: '/module/compare', active:false},
          ]});

        // Resolve
        resolve();
      }).catch(reject);
    });
  }
}

var singleBarGraphRender = function(div, labels, series) {
  // The bar graph code
  var barGraphCode = function(div, labels, series) {
    // // console.log(series)
    series = !Array.isArray(series) ? [series] : series;
    console.log(series)

    // console.log(JSON.stringify(series))
    console.log(series[0])

    var chart = new Chartist.Line(div, {
      labels: labels,
      series:series
    }, {
      scaleMinSpace: 20,
      plugins: [
        Chartist.plugins.tooltip()
      ],
      axisY: {
        scaleMinSpace: 25
      }
    });
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
          }).project({
            'name':1,
            'stats.last30days':1,
            'stats.total':1,
            'stats.perYears':1
          }).sort({'stats.last30days':-1}).toArray();
        }

        // Generate the values
        results[1].stats.perMonth.reverse().forEach(function(x) {
          var date = moment(x.start);
          labels.push(date.format("M/YY"));
          values.push(x.value);
        });

        // Render the main template
        var body = yield render('module', {
          bar_graph: singleBarGraphRender('#ct-chart', labels, [{
            name: npmModule, value: values
          }]),
          name: npmModule,
          module: results[0],
          downloads: results[1],
          dependentsByName: dependentsByName,
          moment: moment
        });

        // Render the final module
        ctx.body = yield render('layout', {
          title:title, body: body, menu: [
            {name: 'Main', href: '/', active:false},
            {name: 'Overview', active:true},
            {name: 'Compare', href: f('/module/compare/%s', npmModule), active:false},
          ]});

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
            $regex: ctx.request.query.search || ''
          }
        }).toArray();

        // Render the main template
        var body = yield render('search', {
          modules: modules,
          moment: moment
        });

        // Render the final module
        ctx.body = yield render('layout', {
          title:title, body: body, menu: [
            {name: 'Main', href: '/', active:false},
            {name: 'Search', active:true},
            {name: 'Compare', href: '/module/compare', active:false},
          ]});
        // Resolve
        resolve();
      }).catch(reject);
    });
  }
}

var module_compare_form = function(title, db) {
  return function(ctx, next) {
    return new Promise(function(resolve, reject) {
      co(function*() {
        // Get the query object
        var query = ctx.request.query;

        // Do we have any errors
        if(query.errors) {
          try {
            query.errors = JSON.parse(query.errors);
          } catch(err) {}
        }

        // Render the main template
        var body = yield render('compare_form', {
          name: ctx.params.module,
          query: query
        });

        // Render the final module
        ctx.body = yield render('layout', {
          title:title, body: body, menu: [
            {name: 'Main', href: '/', active:false},
            {name: 'Compare', active:true},
          ]});

        // Resolve
        resolve();
      }).catch(reject);
    });
  }
}

var addError = function(self, field, isError, message) {
  if(isError) {
    if(!self.errors) self.errors = {};
    self.errors[field] = message;
  }
}

var hasErrors = function(self) {
  if(self.errors && Object.keys(self.errors).length > 0) return true;
  return false;
}

var saveStateAndRedirect = function(ctx, route, state) {
  // Serialize the errors
  if(state.errors) state.errors = JSON.stringify(state.errors);
  // Redirect
  ctx.response.redirect(url.format({
    pathname: route, query: state
  }));
}

var module_compare_result = function(title, db) {
  return function(ctx, next) {
    var self = this;

    return new Promise(function(resolve, reject) {
      co(function*() {
        // Unpack all the query fields
        var query = ctx.request.query;
        var compare1 = query.compare1 = query.compare1 || '';
        var compare2 = query.compare2 = query.compare2 || '';
        var aggregate = query.aggregate = query.aggregate || false;

        addError(query, 'compare1', compare1 == '' , f('no module passed in', compare1));
        addError(query, 'compare2', compare2 == '', f('no modules to compare passed in', compare2));

        // Redirect to the form
        if(hasErrors(query)) {
          saveStateAndRedirect(ctx, '/module/compare', query);
          return resolve();
        }

        // Do we have module, grab it
        var mainModule = yield db.collection('downloads').findOne({ name: compare1 });
        // All other modules
        var compareModules = yield db.collection('downloads').find({
            name: {
              $in: compare2.split(',').map(function(x) {
                return x.trim();
              })
            }
          }).toArray();

        // Add any errors
        addError(query, 'compare1', !mainModule, f('module [%s] not found', compare1));
        addError(query, 'compare2', compareModules.length == 0, f('none of the modules [%s] found', compare2));

        // Redirect to the form
        if(hasErrors(query)) {
          saveStateAndRedirect(ctx, '/module/compare', query);
          return resolve();
        }

        if(!aggregate) {
          var compare = aggregatePrMonthInSingleGraph('#compare_graph',
            [mainModule].concat(compareModules)
          );
        } else {
          var compare = aggregateAllModulesPrMonth('#compare_graph',
            compareModules, mainModule
          );
        }

        // Render the main template
        var body = yield render('compare_results', {
          compare: compare,
          query: query,
          name: compare1
        });

        // Render the final module
        ctx.body = yield render('layout', {
          title:title, body: body, menu: [
            {name: 'Main', href: '/', active:false},
            {name: 'Compare', active:true},
          ]});

        // Resolve
        resolve();
      }).catch(reject);
    });
  }
}

var aggregateAllModulesPrMonth = function(root, modules, comparative) {
  var max = 0;
  var index = 0;
  var names = [];

  var aggregatedValues = modules.map(function(x, i) {
    var labels = [], values = [];
    // Add name to list
    names.push(x.name);

    // Find longest value
    if(max < x.stats.perMonth.length) {
      max = x.stats.perMonth.length;
      index = i;
    }

    x.stats.perMonth.reverse().forEach(function(y) {
      var date = moment(x.start);
      labels.push(date.format("M/YY"));
      values.push(y.value);
    });

    return { labels: labels, values: values };
  });

  // Get the longest value
  var longest = aggregatedValues.splice(index, 1).shift();

  // No add up all the values
  aggregatedValues.forEach(function(x) {
    x.values.forEach(function(y, i) {
      longest.values[i] = longest.values[i] + y;
    });
  });

  var finalValues = [{
    name: names.join(','),
    value: longest.values
  }];

  if(comparative) {
    var vals = [];
    // Generate all the values
    comparative.stats.perMonth.reverse().forEach(function(y) {
      vals.push(y.value);
    });

    finalValues.push({
      name: comparative.name, value: vals
    });
  }

  // Return the graph
  return [{
    module: {name: names.join(',') },
    div: f('%s_0', root.replace('#', '')),
    graph: singleBarGraphRender(f('%s_0', root), longest.labels, finalValues)
  }];
}

var aggregatePrMonth = function(root, modules) {
  return modules.map(function(x, i) {
    var labels = [], values = [];

    x.stats.perMonth.reverse().forEach(function(y) {
      var date = moment(x.start);
      labels.push(date.format("M/YY"));
      values.push(y.value);
    });

    return {
      module: x,
      div: f('%s_%s', root.replace('#', ''), i),
      graph: singleBarGraphRender(f('%s_%s', root, i), labels, {
        name: x.name, value: values
      })
    }
  });
}

var aggregatePrMonthInSingleGraph = function(root, modules) {
  var values = [];
  var labels = [];
  var names = [];

  modules.forEach(function(x, i) {
    values[i] = {
      name: x.name,
      value: []
    };

    if(i > 0) names.push(x.name);

    x.stats.perMonth.reverse().forEach(function(y,j) {
      var date = moment(x.start);
      labels[j] = date.format("M/YY");
      values[i].value.push(y.value);
    });
  });

  return [{
    module: {name: names.join(',') },
    div: f('%s_0', root.replace('#', '')),
    graph: singleBarGraphRender(f('%s_0', root), labels, values)
  }];
}

// Var application title
var title = 'NPM statistics application';

// Co function
co(function*(){
  // Get a connection
  var db = yield MongoClient.connect(uri);

  // Add a router entry
  router.get('/module/search', module_search(title, db));
  router.get('/module/:module', module_view(title, db));
  router.get('/module/compare/:module', module_compare_form(title, db));
  router.get('/module/compare', module_compare_form(title, db));
  router.get('/module/compare_results', module_compare_result(title, db));
  router.get('/', main(title, db));

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
