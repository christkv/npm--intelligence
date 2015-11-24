"use strict"

var co = require('co'),
  moment = require('moment'),
  MongoClient = require('mongodb').MongoClient;

class Registry {
  constructor(url, options) {
    this.registry = require('npm-stats')(url, options);
  }

  module(name) {
    return new NPMModule(this.registry, name);
  }
}

class NPMModule {
  constructor(registry, name) {
    this.registry = registry;
    this.name = name;
  }

  info() {
    var self = this;

    return new Promise(function(resolve, reject) {
      self.registry.module(self.name).info(function(err, r) {
        if(err) return reject(err);
        resolve(r);
      });
    });
  }

  downloads() {
    var self = this;

    return new Promise(function(resolve, reject) {
      self.registry.module(self.name).downloads(function(err, r) {
        if(err) return reject(err);
        resolve(r);
      });
    });
  }

  dependents() {
    var self = this;

    return new Promise(function(resolve, reject) {
      self.registry.module(self.name).dependents(function(err, r) {
        if(err) return reject(err);
        resolve(r);
      });
    });
  }
}

// Details
var url = 'mongodb://localhost:27017/npmintel';

// Get a registry entry
var registry = new Registry();
var db = null;

var cleanUp = function(object) {
  for(var name in object) {
    var value = object[name];
    var cleanName = name.replace(/\./g, '%20');
    delete object[name];
    object[cleanName] = value;

    if(value != null && typeof value == 'object') {
      object[cleanName] = cleanUp(value);
    }
  }

  return object;
}

var sumDownloadsRange = function(start, end, downloads) {
  // Total downloads
  var total = 0;
  // Sum up all the downloads for the last 30 days
  downloads.forEach(function(x) {
    var date = new Date(x.date);

    if(date.getTime() >= start.getTime()
      && date.getTime() <= end.getTime()) {
      total = total + x.value;
    }
  });

  return total;
}

var sumDownloadsByWeeks = function(initial, weeks, downloads) {
  var date = moment().subtract(1, 'week');
  var results = [];

  for(var i = 0; i < weeks; i++) {
    // Get start and end date
    var start = moment(date).startOf('week').toDate();
    var end = moment(date).endOf('week').toDate();

    // Add the next result
    results.push({
      start: start, end: end, value: sumDownloadsRange(start, end, downloads)
    });

    // Subtract a month
    date = date.subtract(1, 'week');
  }

  // Return all the results
  return results;
}

var sumDownloadsByMonths = function(initial, months, downloads) {
  var date = moment().subtract(1, 'month');
  var results = [];

  for(var i = 0; i < months; i++) {
    // Get start and end date
    var start = moment(date).startOf('month').toDate();
    var end = moment(date).endOf('month').toDate();

    // Add the next result
    results.push({
      start: start, end: end, value: sumDownloadsRange(start, end, downloads)
    });

    // Subtract a month
    date = date.subtract(1, 'month');
  }

  // Return all the results
  return results;
}

var sumDownloadsByYears = function(initial, years, downloads) {
  var date = moment();
  var results = [];

  for(var i = 0; i < years; i++) {
    // Get start and end date
    var start = moment(date).startOf('year').toDate();
    var end = moment(date).endOf('year').toDate();

    // Add the next result
    results.push({
      start: start, end: end, value: sumDownloadsRange(start, end, downloads)
    });

    // Subtract a month
    date = date.subtract(1, 'year');
  }

  // Return all the results
  return results;
}

// Modules to resolve
var modulesToResolve = {
  "mongoose": true
}

/*
 * Download the meta information about a specific module
 */
var updateModule = function(moduleName, db, options) {
  options = options || {resolveDependents: false};

  return new Promise(function(resolve, reject) {
    co(function*() {
      // Get the module information
      var m = yield registry.module(moduleName).info();

      // Replacement versions
      var versions = [];
      // Modify the object to be better compatible with mongod
      for(var name in m.versions) {
        var version = m.versions[name];
        var dependencies = [];

        // Fix dependencies
        for(var n in version.dependencies) {
          dependencies.push({
            name: n, version: version.dependencies[n]
          });
        }

        // Replace the dependencies
        version.dependencies = dependencies;

        // Push to the list of versions
        versions.push(m.versions[name]);
      }

      // Set the value
      m.versions = versions;

      var time = [];
      // Clean up the time
      for(var name in m.time) {
        time.push({
          field: name, value: m.time[name]
        });
      }

      // Set the value
      m.time = time;

      var users = [];
      // Clean up users
      for(var name in m.users) {
        users.push({
          name: name, isUser: m.users[name]
        })
      }

      // Set the value
      m.users = users;

      // Clean up all the field names
      m = cleanUp(m);

      // Store the information
      yield db.collection('modules').replaceOne({name: moduleName}, m, {upsert:true});

      // Get the downloads for the module
      var m = yield registry.module(moduleName).downloads();

      // Let's aggregate up the download values
      // Establish the range of the last 30 days
      var end = new Date();
      var start = new Date();
      start.setHours(-1 * (30 * 24));
      // Total downloads
      var lastThirtyDays = sumDownloadsRange(start, end, m);

      // Downloads per week
      var downloadsPerWeek = sumDownloadsByWeeks(new Date(), 54 * 4, m);

      // Downloads per month
      var downloadsPerMonth = sumDownloadsByMonths(new Date(), 12 * 4, m);

      // Downloads per year
      var downloadsPerYear= sumDownloadsByYears(new Date(), 4, m);

      // Total
      var total = 0;
      m.forEach(function(x) { total = total + x.value; })

      // Store the information about downloads
      yield db.collection('downloads').replaceOne({
        name: moduleName
      }, {
        name: moduleName, downloads: m, stats: {
          total: total,
          last30days: lastThirtyDays,
          perWeek: downloadsPerWeek,
          perMonth: downloadsPerMonth,
          perYears: downloadsPerYear
        }
      }, {upsert:true});

      // Did we want to resolve the dependencies and get that information
      if(options.resolveDependents) {
        var dependents = yield registry.module(moduleName).dependents();

        // Update dependents list
        yield db.collection('dependents').replaceOne({
          name: moduleName
        }, {
          name: moduleName, dependents: dependents
        }, {upsert:true});

        // For each of the dependents resolve the data and update them
        for(var i = 0; i < dependents.length; i++) {
          console.log("[fetching dependent] " + dependents[i]);
          yield updateModule(dependents[i], db, {
            resolveDependents: modulesToResolve[dependents[i]] == true
          });
        }
      }

      // Return
      resolve();
    }).catch(reject);
  });
}

// Execute the method
var execute = function() {
  // Connect to mongodb
  co(function*() {
    // Get the database
    db = yield MongoClient.connect(url);
    // Module name
    var moduleName = 'mongodb';
    // Resolve the module
    yield updateModule(moduleName, db, {resolveDependents:true});
    // Return
    db.close();
    // Wait for 24h and rerun
    setTimeout(function() {
      execute();
    }, (1000 * 60 * 60 * 24));
  }).catch(function(err) {
    console.log(err.stack);
    if(db) db.close();
  });
}

// Execute collection of modules
execute();
