/**
 * This is an example of a basic node.js script that performs
 * the Authorization Code oAuth2 flow to authenticate against
 * the Spotify Accounts.
 *
 * For more information, read
 * https://developer.spotify.com/web-api/authorization-guide/#authorization_code_flow
 */

var express = require('express'); // Express web server framework
var session = require('express-session');
var request = require('request'); // "Request" library
var async = require('async');
var querystring = require('querystring');
var cookieParser = require('cookie-parser');
var config = require('./config.js');

var client_id = config.client_id;
var client_secret = config.client_secret;
var redirect_uri = config.redirect_uri;
var tmAPIKey = config.tm_api_key;

/**
 * Generates a random string containing numbers and letters
 * @param  {number} length The length of the string
 * @return {string} The generated string
 */
var generateRandomString = function(length) {
  var text = '';
  var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  for (var i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};

/**
 * Redirects request to authorize the application through Spotify.
 * @param res The Express response object
 */
var loginWithSpotify = function(res) {
  var state = generateRandomString(16);
  res.cookie(stateKey, state);

  // your application requests authorization
  var scope = 'user-top-read user-follow-read user-read-private user-read-email';
  res.redirect('https://accounts.spotify.com/authorize?' +
    querystring.stringify({
      response_type: 'code',
      client_id: client_id,
      scope: scope,
      redirect_uri: redirect_uri,
      state: state
    }));
}

var stateKey = 'spotify_auth_state';

var app = express();
app.use(session({
  secret:'sample-secret',
  resave: false,
  saveUninitialized: true
}));

app.use(function(req, res, next){
  if(req.url.indexOf('/css') == -1 && req.url.indexOf('/callback') == -1){
    var currentTime = new Date().getTime();
    console.log(req.url);
    if(!req.session.access_token){
      loginWithSpotify(res);
    }else if((currentTime + (60 * 60)) >= req.session.access_token_expiry){
      console.log('token is about to or has expired!');
    }else{
      next();
    }
  }else{
    next();
  }
});

app.use(express.static(__dirname + '/public'))
   .use(cookieParser());

app.get('/callback', function(req, res) {

  // your application requests refresh and access tokens
  // after checking the state parameter

  var code = req.query.code || null;
  var state = req.query.state || null;
  var storedState = req.cookies ? req.cookies[stateKey] : null;

  if (state === null || state !== storedState) {
    res.redirect('/#' +
      querystring.stringify({
        error: 'state_mismatch'
      }));
  } else {
    res.clearCookie(stateKey);
    var authOptions = {
      url: 'https://accounts.spotify.com/api/token',
      form: {
        code: code,
        redirect_uri: redirect_uri,
        grant_type: 'authorization_code'
      },
      headers: {
        'Authorization': 'Basic ' + (new Buffer(client_id + ':' + client_secret).toString('base64'))
      },
      json: true
    };

    request.post(authOptions, function(error, response, body) {
      if (!error && response.statusCode === 200) {

        var access_token = body.access_token,
            refresh_token = body.refresh_token;

        req.session.access_token = access_token;
        req.session.access_token_expiry = (new Date().getTime()) + (1 * 60 * 60 * 1000); // access token will expire in one hour
        req.session.refresh_token = refresh_token;

        var options = {
          url: 'https://api.spotify.com/v1/me',
          headers: { 'Authorization': 'Bearer ' + access_token },
          json: true
        };

        // use the access token to access the Spotify Web API
        request.get(options, function(error, response, body) {
          console.log(body);
        });

        // we can also pass the token to the browser to make requests from there
        res.redirect('/#' +
          querystring.stringify({
            access_token: access_token,
            refresh_token: refresh_token
          }));
      } else {
        res.redirect('/#' +
          querystring.stringify({
            error: 'invalid_token'
          }));
      }
    });
  }
});

app.get('/refresh_token', function(req, res) {

  // requesting access token from refresh token
  var refresh_token = req.query.refresh_token;
  var authOptions = {
    url: 'https://accounts.spotify.com/api/token',
    headers: { 'Authorization': 'Basic ' + (new Buffer(client_id + ':' + client_secret).toString('base64')) },
    form: {
      grant_type: 'refresh_token',
      refresh_token: refresh_token
    },
    json: true
  };

  request.post(authOptions, function(error, response, body) {
    if (!error && response.statusCode === 200) {
      var access_token = body.access_token;
      res.send({
        'access_token': access_token
      });
    }
  });
});

app.get('/get/profile', function(req, res){
  var profileOptions = {
    url: 'https://api.spotify.com/v1/me',
    headers:{
      'Authorization': 'Bearer ' + req.session.access_token
    },
    json: true
  };

  request.get(profileOptions, function(error, response, body){
    if(!error && response.statusCode === 200){
      res.send({
        'user': body
      });
    }
  });
});

app.get('/get/artists', function(req, res){
  var artistOptions = {
    url: 'https://api.spotify.com/v1/me/following?type=artist',
    headers:{
      'Authorization': 'Bearer ' + req.session.access_token
    },
    json: true
  };

  request.get(artistOptions, function(error, response, body){
    if(!error && response.statusCode === 200){
      res.send({
        'artists': body.artists.items
      });
    }
  });
});

app.get('/get/events', function(req, res){
	var artists = JSON.parse(req.query.artists);
	var geoPoint = req.query.geoPoint;
	var today = new Date().toISOString().split('.')[0]+"Z";

	var events = [];
	async.each(artists, function(artist, callback){
		var eventsOptions = {
			url: 'https://app.ticketmaster.com/discovery/v2/events?apikey='+tmAPIKey+'&radius=150&unit=miles&countryCode=US&startDateTime='+today+'&geoPoint='+geoPoint+'&keyword='+artist,
			json: true
		};

		request.get(eventsOptions, function(error, response, body){
			if(body._embedded){
				var eventList = body._embedded.events;
				for(var j = 0; j < eventList.length; j++){
					// need to set some extra attributes to make templating easier
					var event = eventList[j];
					var eventIds = events.map(x => x.id);
					if(eventIds.indexOf(event.id) == -1){
						if(event.distance > 50) event.distanceWarning = true;

						var searchedName = body._links.self.href.split('&keyword=')[1].split('&')[0].split('+').join(" ");
						var attractions = event._embedded.attractions;
						if(event.name.toLowerCase().indexOf(searchedName.toLowerCase()) == -1 || attractions.length > 1){
							event.hasHeadliner = true;
							var supportingAct = "";
							for(var k = 1; (k < attractions.length && k < 4); k++){
								if(k > 1) supportingAct += ", ";
								supportingAct += attractions[k].name;
							}
							if(attractions.length > 4) supportingAct += ". . .";
							event.supportingAct = supportingAct;
						}else event.hasHeadliner = false;

						event.displayName = event._embedded.attractions[0].name;
						events.push(event);
					}
				}
			}
			callback();
		});

	}, function(err){
		if(err){
			console.log('A call to the Ticketmaster API caused an error.');
			res.send({
				'error': 'A call to the Ticketmaster API caused an error.'
			});
		}else{
			res.send({
				'events': events
			});
		}
	});

});

console.log('Listening on 3000');
app.listen(3000);
