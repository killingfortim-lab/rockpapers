const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

app.use(express.static('public'));

let adminId = null; 
let users = {}; 
let choices = { p1: null, p2: null };
let scores = { p1: 0, p2: 0 }; 

// Вспомогательная функция для сборки данных о счете и именах
function getScoreData() {
    let p1Name = "Игрок 1";
    let p2Name = "Игрок 2";

    for (let id in users) {
        if (users[id].role === 'p1') p1Name = users[id].name;
        if (users[id].role === 'p2') p2Name = users[id].name;
    }

    return {
        p1: { name: p1Name, score: scores.p1 },
        p2: { name: p2Name, score: scores.p2 }
    };
}

io.on('connection', (socket) => {
    socket.emit('init', { adminExists: !!adminId });
    io.emit('update_score', getScoreData()); 

    socket.on('join_lobby', (data) => {
        const { nickname, asAdmin } = data;
        if (!nickname || nickname.trim() === '') return; 

        if (asAdmin && !adminId) {
            adminId = socket.id;
            users[socket.id] = { name: nickname, role: 'admin' };
        } else {
            users[socket.id] = { name: nickname, role: 'waiting' };
        }

        socket.emit('joined', users[socket.id].role);
        io.emit('status', `👋 ${nickname} вошел в лобби.`);
        broadcastLobby(); 
        io.emit('update_score', getScoreData());
    });

    socket.on('assign_role', ({ targetId, role }) => {
        if (socket.id !== adminId) return; 

        for (let id in users) {
            if (users[id].role === role) {
                users[id].role = 'waiting';
                io.to(id).emit('role_assigned', 'waiting');
            }
        }

        if (users[targetId]) {
            users[targetId].role = role;
            scores[role] = 0; // Сброс счета при смене игрока
            io.to(targetId).emit('role_assigned', role);
            io.emit('status', `👑 Админ назначил ${users[targetId].name} как Игрок ${role === 'p1' ? '1' : '2'}`);
        }
        
        broadcastLobby();
        io.emit('update_score', getScoreData()); // Синхронизируем имена в счетчике
    });

    socket.on('choice', (choice) => {
        const user = users[socket.id];
        if (!user) return;

        if (user.role === 'p1') choices.p1 = choice;
        if (user.role === 'p2') choices.p2 = choice;

        io.emit('status', `⏳ ${user.name} сделал выбор...`);

        if (choices.p1 && choices.p2) {
            const data = getScoreData();
            let resultText = '';

            if (choices.p1 === choices.p2) {
                resultText = 'Ничья! 🤝';
            } else if (
                (choices.p1 === 'rock' && choices.p2 === 'scissors') ||
                (choices.p1 === 'scissors' && choices.p2 === 'paper') ||
                (choices.p1 === 'paper' && choices.p2 === 'rock')
            ) {
                resultText = `🎉 Победил(а) ${data.p1.name}!`;
                scores.p1++;
            } else {
                resultText = `🎉 Победил(а) ${data.p2.name}!`;
                scores.p2++;
            }

            io.emit('result', { 
                p1: choices.p1, p2: choices.p2, 
                p1Name: data.p1.name, p2Name: data.p2.name, 
                result: resultText 
            });
            
            io.emit('update_score', getScoreData()); 
            choices = { p1: null, p2: null }; 
        }
    });

    socket.on('disconnect', () => {
        if (users[socket.id]) {
            const role = users[socket.id].role;
            io.emit('status', `🚪 ${users[socket.id].name} покинул игру.`);
            delete users[socket.id];
            if (role === 'p1' || role === 'p2') {
                scores[role] = 0;
            }
        }
        if (socket.id === adminId) {
            adminId = null; 
            io.emit('init', { adminExists: false });
        }
        broadcastLobby();
        io.emit('update_score', getScoreData());
    });

    function broadcastLobby() {
        if (adminId) io.to(adminId).emit('lobby_users', users);
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер запущен`));