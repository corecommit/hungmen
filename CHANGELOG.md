# Changelog

All notable changes to this project will be documented in this file.

## v1.2.0

**ADDED**

• **MongoDB Atlas Integration** - Complete migration from local JSON file storage to cloud-based MongoDB Atlas for persistent data storage, solving the data loss issue on Render.com deployments

• **Username Change Data Transfer** - Stats, avatar, ban status, and play time now automatically transfer when users change their username

• **Changelog System** - Added version display next to build number and a "Changelog" button that fetches and displays the full CHANGELOG.md from GitHub

• **Scrollable Admin Panel** - Redesigned admin panel to be more compact with internal scrolling for better usability on smaller screens

**CHANGED**

• **Database Architecture** - Migrated from file-based storage to MongoDB for all user data including stats, avatars, bans, and game history

• **User Data Persistence** - User information now persists indefinitely across server restarts and deployments without any data loss

**FIXED**

• **Admin Panel UI** - Fixed button overflow and layout issues in the maintenance mode modal

• **Coin Flip Animation** - Fixed duplicate animation triggering when both players selected coin sides simultaneously

• **MongoDB Connection** - Removed deprecated connection options (useNewUrlParser, useUnifiedTopology) that were causing connection failures

---

## v1.1.0

**ADDED**

• **Maintenance Mode** - New feature allowing admins to enable maintenance mode that blocks all non-admin users from logging in with a custom message

• **Database Backup System** - Complete backup management system for admins including create backup, list backups, restore from backup, and delete backup functionality

• **Coin Flip System for Custom Word Mode** - Players now choose Heads or Tails to determine who sets the custom word
  - Supports both 1v1 and team modes (2v2, 3v3, 4v4)
  - Animated 3-2-1 countdown with slot machine style reveal
  - Team leaders only can choose in team modes

• **Admin Username Protection** - System now blocks username variations like "admin67", "admin69", preventing confusion with the real admin account

• **User Database Management** - Comprehensive user management interface in admin panel for viewing, editing, and deleting user accounts

• **Enhanced Ban System** - Improved ban checking with automatic unbanning when temporary bans expire

**CHANGED**

• **Custom Word Mode Logic** - Changed from host always setting the word to a fair coin flip system where winner chooses

• **Admin Panel Organization** - Restructured into logical sections: Room Management, Announcements, User Database, and Server Tools

• **Banned User Behavior** - Banned users can now login to see they're banned but cannot join rooms or play games

**FIXED**

• **Login Page Issues** - Fixed JavaScript syntax error that was causing page refresh instead of proper login handling

• **Duplicate Modal Bug** - Fixed user database modal creating duplicate instances when clicking refresh

• **Database Display** - Fixed issue where deleted users weren't being removed from the display panel

---

## v1.0.0

**ADDED**

• **Multiplayer Hangman Game** - Full real-time multiplayer word guessing game built with Socket.IO

• **Room System** - Complete room management allowing players to create and join game rooms with optional passwords

• **Multiple Game Modes** - Support for various play styles:
  - Solo mode for practice
  - 1v1 competitive mode
  - Team modes (2v2, 3v3, 4v4)
  - Custom word mode where players choose words

• **User Authentication** - Simple username-based login system with session management

• **Statistics Tracking** - Comprehensive stats tracking for wins, losses, and total games played

• **Avatar System** - Custom profile picture upload with automatic compression and resizing

• **In-Game Chat** - Real-time chat functionality for both lobby and individual game rooms

• **Admin Control Panel** - Complete admin interface for managing rooms, users, and system settings

• **Ban System** - Full ban management with support for temporary and permanent bans

• **Build Information Display** - Shows current build/commit hash for version tracking

• **Responsive Design** - Mobile-friendly interface that works on all device sizes

**FEATURES**

• Real-time gameplay synchronization using Socket.IO
• Extensive word database with various difficulty categories
• Configurable hint system with adjustable hint counts
• Spectator mode for eliminated players to watch games
• Complete game history and player statistics
• Admin broadcast messaging system
• Player kick functionality from rooms
• Room deletion capabilities (admin only)
• Chat history clearing (admin only)
• User data editing and management tools

---

**Version Legend:**
- **ADDED** - New features and functionality
- **CHANGED** - Modifications to existing features
- **FIXED** - Bug fixes and error corrections
- **REMOVED** - Features that have been removed
