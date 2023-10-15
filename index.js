import {authenticate} from './auth.js';
import SpotifyWebApi from 'spotify-web-api-node';

// require('dotenv').config({ path: 'secrets.env' })

const scopes = ['user-read-private', 'user-read-email', 'user-read-recently-played', 'playlist-read-private'];
const state = 'some-state-of-my-choice';

// // credentials are optional
// const spotifyApi = new SpotifyWebApi({
//   clientId: process.env.CLIENT_ID,
//   clientSecret: process.env.CLIENT_SECRET,
//   redirectUri: 'http://localhost:3000'
// });





// Create the authorization URL
// var authorizeURL = spotifyApi.createAuthorizeURL(scopes, state);
// console.log(authorizeURL);
// process.exit(0);

// spotifyApi.authorizationCodeGrant(accessCode)
// .then(
//   function(data) {
//     console.log('The token expires in ' + data.body['expires_in']);
//     console.log('The access token is ' + data.body['access_token']);
//     console.log('The refresh token is ' + data.body['refresh_token']);

//     // Set the access token on the API object to use it in later calls
//     spotifyApi.setAccessToken(data.body['access_token']);
//     spotifyApi.setRefreshToken(data.body['refresh_token']);
//   },
//   function(err) {
//     console.log('Something went wrong!', err);
//   }
// );


// console.log(authorizeURL);

// spotifyApi.getMyRecentlyPlayedTracks({
//   limit : 20
// }).then(function(data) {
//     // Output items
//     console.log("Your 20 most recently played tracks are:");
//     data.body.items.forEach(item => console.log(item.track));
//   }, function(err) {
//     console.log('Something went wrong!', err);
//   });

async function run() {
  const accessToken = await authenticate({scopes});

  const spotifyApi = new SpotifyWebApi({
    clientId: process.env.CLIENT_ID,
  });

  if (accessToken) {
    spotifyApi.setAccessToken(accessToken);
    // spotifyApi.accessToken = accessCode;
  }


  const playlists = await spotifyApi.getUserPlaylists({
    limit: 50
  });

  console.log(playlists.body);

}

run().catch(function(err) {
    console.log('Something went wrong!', err);
  });