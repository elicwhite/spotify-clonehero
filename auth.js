// Modified from lrholmes/spotify-auth-cli
import dotenv from 'dotenv';
import open from 'open';
import express from 'express';
import path from 'path';
import http from 'http';

dotenv.config({path: 'secrets.env'});

const PORT = 3000;
const CLIENT_ID = process.env.CLIENT_ID;
const SHOW_DIALOG = false;
// const SCOPE = ['user-read-recently-played'].join('%20');

const REDIRECT_URI = 'http://localhost:' + PORT + '/callback';

export function authenticate({scopes}) {
  const URL =
    'https://accounts.spotify.com/authorize' +
    '?client_id=' +
    CLIENT_ID +
    '&response_type=token' +
    '&scope=' +
    scopes.join('%20') +
    '&show_dialog=' +
    SHOW_DIALOG +
    '&redirect_uri=' +
    REDIRECT_URI;

  return new Promise((resolve, reject) => {
    const app = express();
    const server = http.createServer(app);

    app.get('/callback', (req, res) => {
      res.sendFile(path.join(process.cwd(), '/callback.html'));
      if (req.query.error) {
        console.log('Something went wrong. Error: ', req.query.error);
        reject(req.queury.error);
      }
    });

    app.get('/token', (req, res) => {
      res.sendStatus(200);
      const token = req.query.access_token;
      if (token) {
        server.close();
        resolve(token);
      }
    });

    server.listen(PORT, () => {
      console.log('Opening the Spotify Login Dialog in your browser...');
      open(URL);
    });
  });
}
