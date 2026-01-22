const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();
const server = http.createServer(app);

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

// Middleware
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

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'your_cloud_name',
  api_key: process.env.CLOUDINARY_API_KEY || 'your_api_key',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'your_api_secret'
});

// Multer storage for Cloudinary
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'discord-clone',
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf', 'doc', 'docx'],
    resource_type: 'auto'
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || '337455';

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/discord-clone';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Enhanced User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'moderator', 'member'], default: 'member' },
  avatar: { type: String, default: 'https://ui-avatars.com/api/?background=5865F2&color=fff&name=' },
  bio: { type: String, default: '' },
  status: { type: String, enum: ['online', 'away', 'busy', 'offline'], default: 'offline' },
  customStatus: { type: String, default: '' },
  isBanned: { type: Boolean, default: false },
  bannedUntil: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  lastSeen: { type: Date, default: Date.now }
});

// Enhanced Message Schema
const messageSchema = new mongoose.Schema({
  channel: { type: String, required: true },
  username: { type: String, required: true },
  message: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  edited: { type: Boolean, default: false },
  editedAt: { type: Date },
  attachments: [{
    url: String,
    filename: String,
    fileType: String,
    size: Number
  }],
  mentions: [{ type: String }],
  reactions: [{
    emoji: String,
    users: [String]
  }]
});

// Direct Message Schema
const dmSchema = new mongoose.Schema({
  participants: [{ type: String, required: true }],
  messages: [{
    sender: { type: String, required: true },
    message: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    read: { type: Boolean, default: false },
    edited: { type: Boolean, default: false },
    attachments: [{
      url: String,
      filename: String,
      fileType: String
    }]
  }],
  lastMessage: { type: Date, default: Date.now }
});

// Channel Schema
const channelSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  description: { type: String, default: '' },
  createdBy: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  isPrivate: { type: Boolean, default: false },
  allowedUsers: [{ type: String }],
  allowedRoles: [{ type: String, default: ['admin', 'moderator', 'member'] }]
});

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);
const DirectMessage = mongoose.model('DirectMessage', dmSchema);
const Channel = mongoose.model('Channel', channelSchema);

// Store online users
let onlineUsers = new Map();

// Middleware untuk auth
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Middleware untuk admin
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Middleware untuk moderator+
const requireModerator = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'moderator') {
    return res.status(403).json({ error: 'Moderator access required' });
  }
  next();
};

// REST API Routes
app.get('/', (req, res) => {
  res.json({ 
    message: 'Discord Clone API v3.0 - Enhanced Edition',
    status: 'OK',
    features: [
      'User Profiles', 'DM System', 'File Upload', 
      'Message Edit/Delete', 'Reactions', 'Mentions',
      'Channel Management', 'Dark Mode', 'User Moderation'
    ],
    timestamp: new Date().toISOString()
  });
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// ==================== AUTH ROUTES ====================

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    
    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userCount = await User.countDocuments();
    const role = userCount === 0 ? 'admin' : 'member';

    const user = new User({ 
      username, 
      email, 
      password: hashedPassword,
      role,
      avatar: `https://ui-avatars.com/api/?background=5865F2&color=fff&name=${encodeURIComponent(username)}`
    });
    await user.save();
    
    res.json({ 
      message: 'User registered successfully', 
      username,
      role 
    });
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
    
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.isBanned) {
      if (user.bannedUntil && user.bannedUntil > new Date()) {
        return res.status(403).json({ 
          error: `Account banned until ${user.bannedUntil.toLocaleString()}` 
        });
      } else if (user.bannedUntil && user.bannedUntil <= new Date()) {
        // Unban if ban expired
        user.isBanned = false;
        user.bannedUntil = null;
        await user.save();
      } else {
        return res.status(403).json({ error: 'Account permanently banned' });
      }
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { 
        id: user._id, 
        username: user.username, 
        role: user.role 
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Update last seen
    user.lastSeen = new Date();
    await user.save();

    res.json({ 
      message: 'Login successful', 
      token,
      user: {
        username: user.username,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        bio: user.bio,
        status: user.status,
        customStatus: user.customStatus
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== USER PROFILE ROUTES ====================

// Get current user profile
app.get('/api/profile', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update user profile
app.put('/api/profile', authenticateToken, async (req, res) => {
  try {
    const { avatar, bio, status, customStatus } = req.body;
    
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { avatar, bio, status, customStatus },
      { new: true }
    ).select('-password');

    // Broadcast profile update to all users
    io.emit('user-profile-updated', {
      username: user.username,
      avatar: user.avatar,
      bio: user.bio,
      status: user.status,
      customStatus: user.customStatus
    });

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload avatar
app.post('/api/profile/avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { avatar: req.file.path },
      { new: true }
    ).select('-password');

    res.json({ 
      message: 'Avatar updated', 
      avatar: user.avatar 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user by username
app.get('/api/users/:username', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username }).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== CHANNEL ROUTES ====================

// Get all channels
app.get('/api/channels', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    let channels;

    if (user.role === 'admin') {
      channels = await Channel.find();
    } else {
      channels = await Channel.find({
        $or: [
          { isPrivate: false },
          { allowedUsers: user.username },
          { allowedRoles: user.role }
        ]
      });
    }

    res.json(channels);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create channel (admin only)
app.post('/api/channels', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, description, isPrivate, allowedUsers, allowedRoles } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Channel name required' });
    }

    const existingChannel = await Channel.findOne({ name });
    if (existingChannel) {
      return res.status(400).json({ error: 'Channel already exists' });
    }

    const channel = new Channel({
      name,
      description,
      createdBy: req.user.username,
      isPrivate: isPrivate || false,
      allowedUsers: allowedUsers || [],
      allowedRoles: allowedRoles || ['admin', 'moderator', 'member']
    });

    await channel.save();

    // Broadcast new channel
    io.emit('channel-created', channel);

    res.json({ message: 'Channel created', channel });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete channel (admin only)
app.delete('/api/channels/:channelId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const channel = await Channel.findByIdAndDelete(req.params.channelId);
    
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    // Delete all messages in channel
    await Message.deleteMany({ channel: channel.name });

    // Broadcast channel deletion
    io.emit('channel-deleted', { channelId: req.params.channelId, name: channel.name });

    res.json({ message: 'Channel deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== MESSAGE ROUTES ====================

// Get messages for a channel
app.get('/api/messages/:channel', authenticateToken, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const messages = await Message.find({ channel: req.params.channel })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Message.countDocuments({ channel: req.params.channel });

    res.json({
      messages: messages.reverse(),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Edit message
app.put('/api/messages/:messageId', authenticateToken, async (req, res) => {
  try {
    const { message } = req.body;
    
    const msg = await Message.findById(req.params.messageId);
    
    if (!msg) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (msg.username !== req.user.username && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    msg.message = message;
    msg.edited = true;
    msg.editedAt = new Date();
    await msg.save();

    // Broadcast edit
    io.to(msg.channel).emit('message-edited', {
      messageId: msg._id,
      message: msg.message,
      edited: true,
      editedAt: msg.editedAt
    });

    res.json(msg);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete message
app.delete('/api/messages/:messageId', authenticateToken, async (req, res) => {
  try {
    const msg = await Message.findById(req.params.messageId);
    
    if (!msg) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (msg.username !== req.user.username && req.user.role !== 'admin' && req.user.role !== 'moderator') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const channel = msg.channel;
    await Message.findByIdAndDelete(req.params.messageId);

    // Broadcast deletion
    io.to(channel).emit('message-deleted', {
      messageId: req.params.messageId
    });

    res.json({ message: 'Message deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add reaction
app.post('/api/messages/:messageId/react', authenticateToken, async (req, res) => {
  try {
    const { emoji } = req.body;
    const msg = await Message.findById(req.params.messageId);
    
    if (!msg) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const existingReaction = msg.reactions.find(r => r.emoji === emoji);
    
    if (existingReaction) {
      if (existingReaction.users.includes(req.user.username)) {
        // Remove reaction
        existingReaction.users = existingReaction.users.filter(u => u !== req.user.username);
        if (existingReaction.users.length === 0) {
          msg.reactions = msg.reactions.filter(r => r.emoji !== emoji);
        }
      } else {
        // Add user to reaction
        existingReaction.users.push(req.user.username);
      }
    } else {
      // New reaction
      msg.reactions.push({
        emoji,
        users: [req.user.username]
      });
    }

    await msg.save();

    // Broadcast reaction update
    io.to(msg.channel).emit('reaction-updated', {
      messageId: msg._id,
      reactions: msg.reactions
    });

    res.json(msg);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search messages
app.get('/api/search', authenticateToken, async (req, res) => {
  try {
    const { query, channel } = req.query;
    
    if (!query) {
      return res.status(400).json({ error: 'Search query required' });
    }

    const searchFilter = {
      message: { $regex: query, $options: 'i' }
    };

    if (channel) {
      searchFilter.channel = channel;
    }

    const messages = await Message.find(searchFilter)
      .sort({ timestamp: -1 })
      .limit(50);

    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload file/attachment
app.post('/api/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    res.json({
      url: req.file.path,
      filename: req.file.originalname,
      fileType: req.file.mimetype,
      size: req.file.size
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== DIRECT MESSAGE ROUTES ====================

// Get DM conversations
app.get('/api/dm', authenticateToken, async (req, res) => {
  try {
    const conversations = await DirectMessage.find({
      participants: req.user.username
    }).sort({ lastMessage: -1 });

    res.json(conversations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get DM with specific user
app.get('/api/dm/:username', authenticateToken, async (req, res) => {
  try {
    const participants = [req.user.username, req.params.username].sort();
    
    let dm = await DirectMessage.findOne({
      participants: { $all: participants }
    });

    if (!dm) {
      dm = new DirectMessage({
        participants,
        messages: []
      });
      await dm.save();
    }

    res.json(dm);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Mark DM as read
app.put('/api/dm/:dmId/read', authenticateToken, async (req, res) => {
  try {
    const dm = await DirectMessage.findById(req.params.dmId);
    
    if (!dm) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    dm.messages.forEach(msg => {
      if (msg.sender !== req.user.username) {
        msg.read = true;
      }
    });

    await dm.save();
    res.json({ message: 'Marked as read' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== ADMIN/MODERATION ROUTES ====================

// Get all users (admin only)
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update user role (admin only)
app.put('/api/admin/users/:userId/role', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { role } = req.body;
    
    if (!['admin', 'moderator', 'member'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { role },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Ban user (admin/moderator)
app.post('/api/admin/users/:userId/ban', authenticateToken, requireModerator, async (req, res) => {
  try {
    const { duration, reason } = req.body; // duration in hours, null for permanent
    
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.role === 'admin' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Cannot ban admin' });
    }

    user.isBanned = true;
    user.bannedUntil = duration ? new Date(Date.now() + duration * 60 * 60 * 1000) : null;
    await user.save();

    // Disconnect user if online
    const socketId = Array.from(onlineUsers.entries())
      .find(([_, userData]) => userData.username === user.username)?.[0];
    
    if (socketId) {
      io.to(socketId).emit('banned', { reason, until: user.bannedUntil });
      const socket = io.sockets.sockets.get(socketId);
      if (socket) socket.disconnect();
    }

    res.json({ 
      message: 'User banned', 
      bannedUntil: user.bannedUntil,
      reason 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Unban user (admin/moderator)
app.post('/api/admin/users/:userId/unban', authenticateToken, requireModerator, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { isBanned: false, bannedUntil: null },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User unbanned', user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete user (admin only)
app.delete('/api/admin/users/:userId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete user's messages
    await Message.deleteMany({ username: user.username });
    
    // Delete user's DMs
    await DirectMessage.deleteMany({ participants: user.username });

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== SOCKET.IO EVENTS ====================

io.on('connection', (socket) => {
  console.log('New user connected:', socket.id);

  // User joins
  socket.on('user-join', async (data) => {
    try {
      const { username, token } = data;
      
      jwt.verify(token, JWT_SECRET, async (err, decoded) => {
        if (err) {
          socket.emit('auth-error', { error: 'Invalid token' });
          return;
        }

        onlineUsers.set(socket.id, { 
          username, 
          role: decoded.role,
          status: 'online'
        });
        
        await User.findByIdAndUpdate(decoded.id, { 
          status: 'online',
          lastSeen: new Date()
        });

        io.emit('users-update', Array.from(onlineUsers.values()));
        console.log(`${username} joined`);
      });
    } catch (error) {
      console.error('User join error:', error);
    }
  });

  // Join channel
  socket.on('join-channel', (channel) => {
    socket.join(channel);
    console.log(`User joined channel: ${channel}`);
  });

  // Send message
  socket.on('send-message', async (data) => {
    try {
      const { channel, username, message, token, attachments, mentions } = data;
      
      jwt.verify(token, JWT_SECRET, async (err) => {
        if (err) {
          socket.emit('message-error', { error: 'Unauthorized' });
          return;
        }

        const newMessage = new Message({ 
          channel, 
          username, 
          message,
          attachments: attachments || [],
          mentions: mentions || []
        });
        await newMessage.save();

        io.to(channel).emit('new-message', {
          _id: newMessage._id,
          username,
          message,
          timestamp: newMessage.timestamp,
          attachments: newMessage.attachments,
          mentions: newMessage.mentions,
          reactions: []
        });

        // Send notification to mentioned users
        if (mentions && mentions.length > 0) {
          mentions.forEach(mentionedUser => {
            const userSocket = Array.from(onlineUsers.entries())
              .find(([_, userData]) => userData.username === mentionedUser)?.[0];
            
            if (userSocket) {
              io.to(userSocket).emit('mentioned', {
                channel,
                by: username,
                message
              });
            }
          });
        }
      });
    } catch (error) {
      console.error('Error saving message:', error);
    }
  });

  // Send DM
  socket.on('send-dm', async (data) => {
    try {
      const { to, from, message, token, attachments } = data;
      
      jwt.verify(token, JWT_SECRET, async (err) => {
        if (err) {
          socket.emit('message-error', { error: 'Unauthorized' });
          return;
        }

        const participants = [from, to].sort();
        
        let dm = await DirectMessage.findOne({
          participants: { $all: participants }
        });

        if (!dm) {
          dm = new DirectMessage({ participants, messages: [] });
        }

        const newMsg = {
          sender: from,
          message,
          timestamp: new Date(),
          read: false,
          attachments: attachments || []
        };

        dm.messages.push(newMsg);
        dm.lastMessage = new Date();
        await dm.save();

        // Send to recipient if online
        const recipientSocket = Array.from(onlineUsers.entries())
          .find(([_, userData]) => userData.username === to)?.[0];
        
        if (recipientSocket) {
          io.to(recipientSocket).emit('new-dm', {
            from,
            message: newMsg,
            dmId: dm._id
          });
        }

        // Confirm to sender
        socket.emit('dm-sent', {
          to,
          message: newMsg,
          dmId: dm._id
        });
      });
    } catch (error) {
      console.error('Error sending DM:', error);
    }
  });

  // User typing
  socket.on('typing', (data) => {
    socket.to(data.channel).emit('user-typing', data.username);
  });

  // User typing in DM
  socket.on('typing-dm', (data) => {
    const recipientSocket = Array.from(onlineUsers.entries())
      .find(([_, userData]) => userData.username === data.to)?.[0];
    
    if (recipientSocket) {
      io.to(recipientSocket).emit('user-typing-dm', data.from);
    }
  });

  // Update status
  socket.on('update-status', async (data) => {
    const { username, status } = data;
    
    await User.findOneAndUpdate(
      { username },
      { status }
    );

    const userData = onlineUsers.get(socket.id);
    if (userData) {
      userData.status = status;
      onlineUsers.set(socket.id, userData);
      io.emit('users-update', Array.from(onlineUsers.values()));
    }
  });

  // Disconnect
  socket.on('disconnect', async () => {
    const userData = onlineUsers.get(socket.id);
    if (userData) {
      const { username } = userData;
      onlineUsers.delete(socket.id);
      
      const user = await User.findOne({ username });
      if (user) {
        await User.findByIdAndUpdate(user._id, { 
          status: 'offline',
          lastSeen: new Date()
        });
      }

      io.emit('users-update', Array.from(onlineUsers.values()));
      console.log(`${username} disconnected`);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Discord Clone Server v3.0 running on port ${PORT}`);
  console.log(`📦 Features: Profiles, DM, File Upload, Reactions, Mentions, Moderation`);
});