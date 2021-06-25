"use strict";

const encoding = "LINEAR16";
const languageCode = "ru-RU";
const profanityFilter = true; // гугловский антимат, сука = с***, срабатывает не всегда
const sampleRateHertz = 16000;
const enableAutomaticPunctuation = true; // автоматическая пунктуация, работает неплохо
const enableWordTimeOffsets = true; // позволяет показать отдельные слова в финальной (!!!) фразе
const streamingLimit = 290000; // длительность стрима, не уверен, что работает, стрим падает всегда через 305 секунд
const singleUtterance = true; // дока говорит, что это нужно поставить для случая голосовой команды

const config = {
  encoding,
  languageCode,
  profanityFilter,
  sampleRateHertz,
  // enableAutomaticPunctuation, // с ней было бы слишком геморно
  enableWordTimeOffsets,
  singleUtterance,
  // streamingLimit,
};

const request = {
  config,
  interimResults: true, // Опция включения промежуточного результата
};

const express = require('express'); // const bodyParser = require('body-parser'); // const path = require('path');
const environmentVars = require('dotenv').config();
// console.log(environmentVars);

const speech = require('@google-cloud/speech');
const speechClient = new speech.SpeechClient({
  projectId: 'speech-to-text-282212',
  keyFilename: './google_speech.json',
}); // Creates a client

const app = express();
const port = process.env.PORT || 3002;

const server =  require('http').createServer(app);

const io = require('socket.io')(server);

app.set('view engine', 'ejs');

io.on('connection', function (client) {

  let prevString = '';
  let prevArr = [];
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
    console.log('Стрим начался');
    startRecognitionStream(this, data);
  });

  client.on('endGoogleCloudStream', function (data) {
    console.log('Стрим закончился');
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

            const sendInterimResult = () => { // функция отправки временного результата;
              currentArr = transcript
                .toLowerCase()
                .split(' ')
                .filter((string, index) => string !== prevArr[index])
              if (currentArr.length === 0 ) return;
              prevArr = currentArr;
              result = `Промежуточный результат: ${prevArr[prevArr.length - 1]} \n Точность: ${stability}`;
              client.emit("speechData", result);
              prevString = transcript;
            }

            if (isFinal) {
              sendInterimResult(); // чтобы не потяреть последнее слово
              result = `Финальный результат: ${transcript} \n Точность: ${confidence}`;
              client.emit("speechData", result);
              prevString = '';
              prevArr = [];
              currentArr = [];
            }

            if (transcript && stability > 0.8 && prevString !== transcript) {
              // проверка на существование слова, его точности и равенство с предыдущим словом
              if (prevArr.length === transcript.split(' ').length) return;
              sendInterimResult();
            }

            results.alternatives[0].words.forEach((wordInfo) => {
              // объект words содержит нужные нам слова, но он доступен только после окончания записи, результат всегда точный
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

// io.on("connection", (client) => {
//   console.log("a user connected");

//   let prevString = '';
//   let prevArr = [];
//   let currentArr = [];
//   let result;

//   const main = () => {
//     const recognizeStream = client
//       .streamingRecognize(request)
//       .on("error", console.error)
//       .on("data", (data) => {
//         const resultArray = data.results[0].alternatives[0];
//         const { transcript, confidence } = resultArray;
//         const [results] = data.results;
//         const { isFinal, stability } = results;

//         const sendInterimResult = () => { // функция отправки временного результата;
//           currentArr = transcript
//             .toLowerCase()
//             .split(' ')
//             .filter((string, index) => string !== prevArr[index])
//           if (currentArr.length === 0 ) return;
//           prevArr = currentArr;
//           result = `Промежуточный результат: ${prevArr[prevArr.length - 1]} \n Точность: ${stability}`;
//           client.emit("textFromGoogle", result);
//           prevString = transcript;
//         }

//         if (isFinal) {
//           sendInterimResult(); // чтобы не потяреть последнее слово
//           result = `Финальный результат: ${transcript} \n Точность: ${confidence}`;
//           client.emit("textFromGoogle", result);
//           prevString = '';
//           prevArr = [];
//           currentArr = [];
//           // try { тут я пробовал остановить запись и сокет после отправления финального результата, вылезает ошибка
//           //   recognizeStream.end();
//           //   recorder.record().stop(); 
//           // } catch (error) {
//           //   console.log(error);
//           // }
//         }

//         if (transcript && stability > 0.8 && prevString !== transcript) {
//           // проверка на существование слова, его точности и равенство с предыдущим словом
//           if (prevArr.length === transcript.split(' ').length) return;
//           sendInterimResult();
//         }

//         results.alternatives[0].words.forEach((wordInfo) => {
//           // объект words содержит нужные нам слова, но он доступен только после окончания записи, результат всегда точный
//           const startSecs =
//             `${wordInfo.startTime.seconds}` +
//             "." +
//             wordInfo.startTime.nanos / 100000000;
//           const endSecs =
//             `${wordInfo.endTime.seconds}` +
//             "." +
//             wordInfo.endTime.nanos / 100000000;
//           const word = `Результат гугла: Word: ${wordInfo.word} ${startSecs} secs - ${endSecs} secs`;
//           client.emit("googleWord", word);
//         });
//       });

//     recorder
//       .record({
//         sampleRateHertz: sampleRateHertz,
//         // Other options, see https://www.npmjs.com/package/node-record-lpcm16#options
//         recordProgram: "rec", // Try also "arecord" or "sox"
//         // endOnSilence: true, // из документации -> automatically end on silence (if supported)
//         //, условия if supported не указаны, у меня не работает
//         // silence: '2.0' // время в секундах, после которого запись по идее должна закончиться
//       })
//       .stream()
//       .on("error", console.error)
//       .pipe(recognizeStream);

//     console.log("Listening, press Ctrl+C to stop.");
//   };

//   process.on("unhandledRejection", (err) => {
//     console.error(err.message);
//     process.exitCode = 1;
//   });

//   client.on("disconnect", () => {
//     console.log("user disconnected");
//   });

//   client.on("message", (msg) => {
//     console.log(msg);
//   });

//   client.on("startRecord", (data) => {
//     console.log('Идёт запись...');
//     main(...process.argv.slice(2));
//   });
// });

server.listen(port, () => {
  console.log("listening on *:3002");
});
