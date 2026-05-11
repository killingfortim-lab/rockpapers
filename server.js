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
// Храним всех пользователей: socket.id -> { name, role }
// role может быть: 'admin', 'waiting', 'p1', 'p2'
let users = {}; 
let choices = { p1: null, p2: null };

io.on('connection', (socket) => {
    // При подключении сообщаем, есть ли уже админ
    socket.emit('init', { adminExists: !!adminId });

    // Обработка входа
    socket.on('join_lobby', (data) => {
        const { nickname, asAdmin } = data;
        
        if (!nickname || nickname.trim() === '') return; // Защита от пустого ника

        if (asAdmin && !adminId) {
            adminId = socket.id;
            users[socket.id] = { name: nickname, role: 'admin' };
        } else {
            users[socket.id] = { name: nickname, role: 'waiting' };
        }

        socket.emit('joined', users[socket.id].role);
        io.emit('status', `👋 ${nickname} вошел в лобби.`);
        broadcastLobby(); // Обновляем панель админа
    });

    // Админ назначает роли
    socket.on('assign_role', ({ targetId, role }) => {
        if (socket.id !== adminId) return; // Только админ может назначать

        // Если эта роль уже кем-то занята, переводим того игрока обратно в зрители
        for (let id in users) {
            if (users[id].role === role) {
                users[id].role = 'waiting';
                io.to(id).emit('role_assigned', 'waiting');
            }
        }

        // Назначаем новую роль выбранному пользователю
        if (users[targetId]) {
            users[targetId].role = role;
            io.to(targetId).emit('role_assigned', role);
            io.emit('status', `👑 Админ назначил ${users[targetId].name} как Игрок ${role === 'p1' ? '1' : '2'}`);
        }
        
        broadcastLobby();
    });

    // Обработка выбора (камень, ножницы, бумага)
    socket.on('choice', (choice) => {
        const user = users[socket.id];
        if (!user) return;

        if (user.role === 'p1') choices.p1 = choice;
        if (user.role === 'p2') choices.p2 = choice;

        io.emit('status', `⏳ ${user.name} сделал выбор...`);

        // Если оба сделали выбор
        if (choices.p1 && choices.p2) {
            let p1Name = "Игрок 1", p2Name = "Игрок 2";
            for (let id in users) {
                if (users[id].role === 'p1') p1Name = users[id].name;
                if (users[id].role === 'p2') p2Name = users[id].name;
            }

            const result = getWinner(choices.p1, choices.p2, p1Name, p2Name);
            io.emit('result', { 
                p1: choices.p1, 
                p2: choices.p2, 
                p1Name, p2Name, result 
            });
            choices = { p1: null, p2: null }; 
        }
    });

    // Обработка отключения
    socket.on('disconnect', () => {
        if (users[socket.id]) {
            io.emit('status', `🚪 ${users[socket.id].name} покинул игру.`);
            delete users[socket.id];
        }
        if (socket.id === adminId) {
            adminId = null; // Если админ ушел, место освобождается
            io.emit('init', { adminExists: false });
            io.emit('status', '⚠️ Админ покинул игру. Требуется новый хост.');
        }
        broadcastLobby();
    });

    // Функция отправки списка игроков админу
    function broadcastLobby() {
        if (adminId) {
            io.to(adminId).emit('lobby_users', users);
        }
    }
});

function getWinner(c1, c2, name1, name2) {
    if (c1 === c2) return 'Ничья! 🤝';
    if (
        (c1 === 'rock' && c2 === 'scissors') ||
        (c1 === 'scissors' && c2 === 'paper') ||
        (c1 === 'paper' && c2 === 'rock')
    ) {
        return `🎉 Победил(а) ${name1}!`;
    }
    return `🎉 Победил(а) ${name2}!`;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});