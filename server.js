const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);

// Socket.io dengan CORS fix
const io = socketIo(server, {
  cors: {
    origin: [
      'https://discord-clone-frontend-seven.vercel.app',
      'http://localhost:3000',
      'https://discord-clone-frontend-gamma.vercel.app'
    ],
    methods: ["GET", "POST"],
    credentials: true
  }
});

// CORS middleware - PENTING untuk fix error
app.use(cors({
  origin: [
    'https://discord-clone-frontend-seven.vercel.app',
    'http://localhost:3000',
    'https://discord-clone-frontend-gamma.vercel.app'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://velove_db:P0o9p0o923@cluster0.wuntgzf.mongodb.net/discord-clone?retryWrites=true&w=majority';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Schema untuk User
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

// Schema untuk Message
const messageSchema = new mongoose.Schema({
  channel: { type: String, required: true },
  username: { type: String, required: true },
  message: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);

// Store online users
let onlineUsers = new Map();

// REST API Routes
app.get('/', (req, res) => {
  res.json({ 
    message: 'Discord Clone API Running',
    status: 'OK',
    timestamp: new Date().toISOString()
  });
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const user = new User({ username, password });
    await user.save();
    
    res.json({ message: 'User registered successfully', username });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    const user = await User.findOne({ username, password });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    res.json({ message: 'Login successful', username });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get messages for a channel
app.get('/api/messages/:channel', async (req, res) => {
  try {
    const messages = await Message.find({ channel: req.params.channel })
      .sort({ timestamp: 1 })
      .limit(100);
    res.json(messages);
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Socket.io Connection
io.on('connection', (socket) => {
  console.log('New user connected:', socket.id);

  // User joins
  socket.on('user-join', (username) => {
    onlineUsers.set(socket.id, username);
    io.emit('users-update', Array.from(onlineUsers.values()));
    console.log(`${username} joined`);
  });

  // Join channel
  socket.on('join-channel', (channel) => {
    socket.join(channel);
    console.log(`User joined channel: ${channel}`);
  });

  // Send message
  socket.on('send-message', async (data) => {
    try {
      const { channel, username, message } = data;
      
      // Save to database
      const newMessage = new Message({ channel, username, message });
      await newMessage.save();

      // Broadcast to channel
      io.to(channel).emit('new-message', {
        username,
        message,
        timestamp: newMessage.timestamp
      });
    } catch (error) {
      console.error('Error saving message:', error);
    }
  });

  // User typing
  socket.on('typing', (data) => {
    socket.to(data.channel).emit('user-typing', data.username);
  });

  // Disconnect
  socket.on('disconnect', () => {
    const username = onlineUsers.get(socket.id);
    onlineUsers.delete(socket.id);
    io.emit('users-update', Array.from(onlineUsers.values()));
    console.log(`${username} disconnected`);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});