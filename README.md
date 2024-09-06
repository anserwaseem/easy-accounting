# Easy Accounting

Easy Accounting is a comprehensive, user-friendly accounting software designed for small to medium-sized businesses. Built with React and Electron, it offers a seamless desktop experience across various platforms. The application leverages Better-sqlite for efficient data management and React Router for smooth navigation within the app.

## Features

- **Cross-Platform Support**: Runs on Windows, and macOS.
- **User-Friendly Interface**: Intuitive design for easy navigation and operation.
- **Data Management**: Utilizes Better-sqlite3 for secure and efficient data storage.
- **Seamless Navigation**: Integrated with React Router for fluid transitions between different sections of the application.

## Getting Started

### Prerequisites

- Node.js version 14 or higher

### Installation

1. Clone the repository:
   ```sh
   git clone https://github.com/anserwaseem/easy-accounting.git
   ```
2. Navigate to the project directory:
   ```sh
   cd easy-accounting
   ```
3. Install dependencies:
   ```sh
   npm install
   ```
4. Start the application in development mode:
   ```sh
   npm start
   ```

### Building for Production

To build the application for production, run:

```sh
npm run package
```

This will compile the application and generate executables Mac and Windows operating systems in the **release/build** directory

## FAQs

- **Q: Automatic linting and testing not working**
  - Run `npx mrm lint-staged` to setup _husky_ in your system.
    >
- **Q: How to check renderer process logs in packaged app**
  - (Mac) Press `Cmd + Option + I` Or Go to 'View' Menu, and select 'Toggle Developer Tools' option.
  - (Windows) Press `Ctrl + Alt + I`
    >
- **Q: How to check main process logs in packaged app**
  - (Mac Live) Open up terminal and Run this command to spin up the app, and logs will appear in the terminal window
  ```shell
  /Applications/Easy\ Accounting.app/Contents/MacOS/Easy\ Accounting
  ```
  - (Mac) check file `main.log` at path: `/Users/<username>/Library/Logs/<Your App Name>.main.log`
  - (Windows) check file `main.log` at path: `C:\Users\<username>\AppData\Roaming\<Your App Name>\logs\main.log`
    >
- **Q: How to check current state of electron-store**
  - (Mac) check file `config.json` at path `/Users/<username>/Library/Application Support/<Your App Name>/config.json`
  - (Windows) check file `config.json` at path `C:\Users\<username>\AppData\Roaming\<Your App Name>\config.json`
    >
- **Q: How to check db being used in packaged app**
  - (Mac) check file `database.db` at path `/Users/<username>/Library/Application Support/<Your App Name>/database.db`
  - (Windows) check directory `C:\Users\<username>\AppData\Roaming\<Your App Name>\database.db`
    >
- **Q: How to check contents of packaged app (and resources exported as-it-is)**
  - (Mac) Open `Applications` directory, find the app, right click and select 'Show Package Contents' option, navigate to `Contents/Resources` directory
  - (Windows) check directory `C:\Users\<username>\AppData\Local\Programs\<Your App Name>`
    >
