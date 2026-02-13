## v1.2.0

### Added
- **MongoDB Atlas Integration** - Migrated from JSON file storage to MongoDB Atlas for persistent data storage on Render.com
- **Username Change Data Transfer** - Stats, avatar, and ban status now transfer when users change their username
- **Changelog System** - Added version display and changelog button that fetches from CHANGELOG.md
- **Admin Panel Scrollable** - Made admin panel smaller and scrollable for better UX

### Changed
- **Database System** - Complete migration from local JSON files to cloud-based MongoDB
- **User Data Persistence** - User stats, avatars, and ban status now persist forever across deployments
- **Build Info Display** - Added version number next to build number in auth screen

### Fixed
- **Admin Panel UI** - Fixed button overflow issues in maintenance mode modal
- **Coin Flip Animation** - Fixed double rolling animation triggering
- **MongoDB Connection** - Removed deprecated connection options causing connection failures

## v1.1.0

### Added
- **Maintenance Mode** - Admins can enable maintenance mode to block non-admin logins
- **Database Backup System** - Export and import user database functionality for admins
- **Coin Flip System** - For custom word mode, players choose Heads/Tails to decide who sets the word
  - Supports 1v1 and team modes (2v2, 3v3, 4v4)
  - Slot machine style animation (3-2-1 countdown)
  - Team leaders only can choose in team modes
- **Admin Username Protection** - Blocks username variations like "admin67", "admin69"
- **User Database Management** - View, edit, delete users from admin panel
- **Ban System Improvements** - Enhanced ban checking and user kick functionality

### Changed
- **Custom Word Mode** - Now uses coin flip instead of host always setting the word
- **Admin Panel Layout** - Organized into sections: Room Management, Announcements, User Database, Server Tools

### Fixed
- **Login Page Refresh** - Fixed JavaScript syntax error causing page refresh on login
- **Duplicate Modals** - Fixed user database modal creating duplicates on refresh
- **Ban System** - Banned users can login but cannot join rooms (as intended)

## v1.0.0

### Added
- **Multiplayer Hangman Game** - Real-time multiplayer word guessing game
- **Room System** - Create and join game rooms with passwords
- **Multiple Game Modes**:
  - Solo mode (practice)
  - 1v1 mode
  - Team modes (2v2, 3v3, 4v4)
  - Custom word mode
- **User Authentication** - Username-based login system
- **User Stats Tracking** - Wins, losses, games played
- **Avatar System** - Custom profile pictures
- **In-Game Chat** - Lobby and room chat functionality
- **Admin Panel** - Basic admin controls for room and user management
- **Ban System** - Ban/unban users with temporary or permanent bans
- **Build Info Display** - Shows current build/commit hash
- **Responsive Design** - Mobile-friendly interface

### Features
- Real-time gameplay with Socket.IO
- Word database with various categories
- Hint system with configurable hint counts
- Spectator mode for eliminated players
- Game history and statistics
- Admin broadcast messages
- Kick players from rooms
- Delete rooms (admin only)
- Clear chat history (admin only)