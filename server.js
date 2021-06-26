"use strict";

const encoding = "LINEAR16";
const languageCode = "ru-RU";
const profanityFilter = true; // google antimat
const sampleRateHertz = 16000;
const enableAutomaticPunctuation = true; // 
const enableWordTimeOffsets = true; // Here I can add words object after stream end
const streamingLimit = 290000; // 
const singleUtterance = true; //

const config = {
  encoding,
  languageCode,
  profanityFilter,
  sampleRateHertz,
  // enableAutomaticPunctuation, // Current logic doedswork with punctuation symbols, not critical, but sad
  enableWordTimeOffsets,
  singleUtterance,
  // streamingLimit,
};

const request = {
  config,
  interimResults: true,
};

const express = require('express'); // const bodyParser = require('body-parser'); // const path = require('path');
const environmentVars = require('dotenv').config();

const speech = require('@google-cloud/speech');
const speechClient = new speech.SpeechClient({
  projectId: 'project',
  keyFilename: './google_speech.json',
}); // Creates a client

const app = express();
const port = process.env.PORT || 3002;

const server =  require('http').createServer(app);

const io = require('socket.io')(server);

app.set('view engine', 'ejs');

io.on('connection', function (client) {

  let prevString = ''; //Here I save each word for compare it with the next word later
  let prevArr = []; //Interim result can send me one result of 2 or 3 word, so I save them there in array
  let currentArr = []; 
  let result;

  console.log('Client Connected to server');
  let recognizeStream = null;

  client.on('join', function (data) {
      client.emit('messages', 'Socket Connected to Server');
  });

  client.on('messages', function (data) {
      client.emit('broad', data);
  });

  client.on('startGoogleCloudStream', function (data) {
    console.log('Stream begin');
    startRecognitionStream(this, data);
  });

  client.on('endGoogleCloudStream', function (data) {
    console.log('Stream end');
    stopRecognitionStream();
  });

  client.on('binaryData', function (data) {
      if (recognizeStream !== null) {
          recognizeStream.write(data);
      }
  });

  function startRecognitionStream(client, data) {
      console.log(' === start recognition stream ====', data);
      if(data && data.config && data.config.languageCode) {
        request.config.languageCode = data.config.languageCode;
      }
      recognizeStream = speechClient.streamingRecognize(request)
          .on('error', (error) => console.log(error, 'error'))
          .on('data', (data) => {

            const resultArray = data.results[0].alternatives[0];
            const { transcript, confidence } = resultArray;
            const [results] = data.results;
            const { isFinal, stability } = results;

            const sendInterimResult = () => { // This function send interim result to client;
              currentArr = transcript
                .toLowerCase()
                .split(' ')
                .filter((string, index) => string !== prevArr[index])
              if (currentArr.length === 0 ) return;
              prevArr = currentArr;
              result = `My Interim result: ${prevArr[prevArr.length - 1]} \n Accuracy: ${stability}`;
              // Stability is only for Interim result, its 0 for final result
              client.emit("speechData", result);
              prevString = transcript;
            }

            if (isFinal) {
              sendInterimResult(); // for not to lose the last word
              result = `My Final result: ${transcript} \n Accuracy: ${confidence}`;
              // Confidence is only for Final result, its 0 for interim result
              client.emit("speechData", result);
              prevString = '';
              prevArr = [];
              currentArr = [];
            }

            if (transcript && stability > 0.8 && prevString !== transcript) {
              // Here I filter words with good stability and remove equal word with prevString 
              if (prevArr.length === transcript.split(' ').length) return;
              sendInterimResult();
            }

            results.alternatives[0].words.forEach((wordInfo) => {
              // object words contains 99.9% correct interim results, but it creates only after stream ending
              const startSecs =
                `${wordInfo.startTime.seconds}` +
                "." +
                wordInfo.startTime.nanos / 100000000;
              const endSecs =
                `${wordInfo.endTime.seconds}` +
                "." +
                wordInfo.endTime.nanos / 100000000;
              const word = `Результат гугла: Word: ${wordInfo.word} ${startSecs} secs - ${endSecs} secs`;
              client.emit("speechData", word);
            });

              // if end of utterance, let's restart stream
              // this is a small hack. After 65 seconds of silence, the stream will still throw an error for speech length limit
              if (data.results[0] && data.results[0].isFinal) {
                  stopRecognitionStream();
                  startRecognitionStream(client);
                  console.log('restarted stream serverside');
              }
          });
  }

  function stopRecognitionStream() {
    console.log(' === stop recognition stream ====');
      if (recognizeStream) {
          recognizeStream.end();
      }
      recognizeStream = null;
  }
});

server.listen(port, () => {
  console.log("listening on *:3002");
});
