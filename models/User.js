// User Model for MongoDB
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    displayName: {
        type: String,
        required: true
    },
    firstLogin: {
        type: Date,
        default: Date.now
    },
    lastLogin: {
        type: Date,
        default: Date.now
    },
    stats: {
        wins: { type: Number, default: 0 },
        losses: { type: Number, default: 0 },
        gamesPlayed: { type: Number, default: 0 }
    },
    avatar: {
        type: String,
        default: null
    },
    totalPlayTime: {
        type: Number,
        default: 0
    },
    serverBan: {
        type: Boolean,
        default: false
    },
    serverBanExpiry: {
        type: Date,
        default: null
    },
    serverBanDuration: {
        type: String,
        default: null
    },
    serverBanReason: {
        type: String,
        default: null
    }
}, {
    timestamps: true
});

// Index for banned users (for faster ban checks)
userSchema.index({ banned: 1 });

const User = mongoose.model('User', userSchema);

module.exports = User;
