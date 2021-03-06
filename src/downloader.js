/*jslint node: true*/
'use strict';

/* Copyright (c) 2014 Intel Corporation. All rights reserved.
 * Use of this source code is governed by an Apache v2 license that can be
 * found in the LICENSE-APACHE-V2 file. */

var Q = require('q');
var path = require('path');
var fs = require('fs');
var url = require('url');

/**
 * Downloader for public files, with progress notifications.
 * @constructor
 *
 * @param {object} [deps] - objects the new instance is dependent on
 * @param {function} [deps.createHttpStream=returns new fetch.FetchStream] -
 * function which takes the downloadUrl of an archive file and returns a stream
 * which will read from that downloadUrl; the default is a function which returns a
 * new {@link external:fetch.FetchStream}
 * @param {object} [deps.fs=node's fs module] - filesystem implementation
 */
var Downloader = function (deps) {
  if (!(this instanceof Downloader)) {
    return new Downloader(deps);
  }

  deps = deps || {};

  this.httpClient = deps.httpClient || require('./http-client')();
  this.fs = deps.fs || fs;
};

/**
 * Generate the output file name for a given archiveUrl and outDir
 * output directory. This can be useful for determining where a downloaded
 * file is going to end up.
 *
 * @param {string} archiveUrl - URL of the xwalk-android archive to download
 * @param {string} outDir - output directory archive is to be downloaded
 * to
 *
 * @returns {string} location of archive in outDir once downloaded
 */
Downloader.prototype.getDownloadLocation = function (downloadUrl, outDir) {
  // the output file path is outDir + the filename part of the downloadUrl
  var urlPath = url.parse(downloadUrl).pathname;
  var urlPathParts = urlPath.split('/');
  var filename = urlPathParts[urlPathParts.length - 1];
  var outFilePath = path.join(outDir, filename);
  return outFilePath;
};

/**
 * Download a file to a specified directory; the file will be placed
 * inside the directory outDir, and have the same name as it has on the
 * remote server.
 *
 * @param {string} downloadUrl - url of file to download
 * @param {string} outDir - directory to put the downloaded file into
 *
 * @returns {external:Promise} resolves to (String outFilePath, File outFile)
 * if the file was downloaded successfully, rejects otherwise;
 * the promise also notifies progress as the file is downloaded as a percentage
 * (whole numbers) of the total which remains to be downloaded.
 */
Downloader.prototype.download = function (downloadUrl, outDir) {
  var self = this;
  var dfd = Q.defer();
  var promise = dfd.promise;

  var outFilePath = this.getDownloadLocation(downloadUrl, outDir);

  if (this.fs.existsSync(outFilePath)) {
    dfd.reject(new Error('output file ' + outFilePath + ' already exists'));
    return promise;
  }

  var outFile = this.fs.createWriteStream(outFilePath);

  var contentLength = 1;
  var downloaded = 0;
  var lastNotifiedPercent = 0;

  // this is set to true to turn off listeners for the "finish" event,
  // as we don't want them to fire and resolve the promise if an
  // error occurs at any point
  var errorOccurred = false;

  // run this to clean up any truncated/unfinished output files
  // and flag an error
  var handleError = function (err) {
    if (self.fs.existsSync(outFilePath)) {
      // remove any unfinished output file which is hanging around
      self.fs.unlinkSync(outFilePath);
    }

    errorOccurred = true;

    dfd.reject(err);
  };

  var req = this.httpClient.getStream(downloadUrl);

  // first time we get any metadata we can set the real content length
  req.on('response', function (response) {
    contentLength = response.headers['content-length'];
  });

  // notify each time the percentage downloaded changes
  req.on('data', function (data) {
    downloaded += parseInt(data.length, 10);

    var percent = parseInt((downloaded / contentLength) * 100, 10);

    if (percent > lastNotifiedPercent) {
      lastNotifiedPercent = percent;
      dfd.notify(percent);
    }
  });

  req.on('end', function (err) {
    if (err) {
      handleError(err);
    }

    outFile.end();
  });

  req.on('error', function (err) {
    handleError(err);
  });

  // this is when we're really done
  outFile.on('finish', function () {
    if (!errorOccurred) {
      dfd.resolve(outFilePath, outFile);
    }
  });

  req.pipe(outFile);

  return promise;
};

module.exports = Downloader;
