# Easy Accounting

Easy Accounting is a comprehensive, user-friendly accounting software designed for small to medium-sized businesses. Built with React and Electron, it offers a seamless desktop experience across various platforms.

## Features

- **Cross-Platform Support**: Runs on Windows, and macOS.
- **User-Friendly Interface**: Intuitive design for easy navigation and operation.
- **Data Management**: Utilizes Better-sqlite3 for secure and efficient data storage.
- **Seamless Navigation**: Integrated with React Router for fluid transitions between different sections of the application.

## Installation

1. Download the appropriate installer for your operating system from the official website or authorized distributor.
2. Run the installer and follow the on-screen instructions.
3. Once installed, launch the application.

Please refer to [troubleshooting guide](#troubleshooting) if you encounter any issue.
Please refer to the [User Manual](docs/USER_MANUAL.md) for a comprehensive guide on all aspects of the application.

## Technology Stack

1. Electron
2. React
3. Typescript
4. Shadcn
5. Tailwind
6. Better-sqlite3
7. Webpack
8. Electron-builder
9. Electron-store
10. Electron-log
11. Electron-updater

## Getting Started

### Development

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

## Troubleshooting

For common issues and their solutions, please refer to our Troubleshooting Guide.

#### Q: Not able to download the app

- **(Mac)** If a dialog appears stating "Easy Accounting cannot be opened because Apple cannot check it for malicious software," then follow these steps:
  1. Press OK on the dialog.
  2. Open the Settings app, navigate to the 'Privacy & Security' section and scroll down to see a button labeled 'Open Anyway.' Click on it.
  3. If prompted, enter your system password.
  4. Another dialog will appear stating "Easy Accounting cannot be opened because Apple cannot check it for malicious software." Press 'Open' to launch the app.
- **(Windows)** If a danger icon appears besides the file being dowloaded, then follow these steps:
  1. Navigate to the downloads page of your browser.
  2. Right-click on the downloaded file.
  3. Select the 'Keep' option to complete the download.
  4. Open the file to begin the installation process.
     >

#### Q: Not able to install the app

- **(Windows)** During the installation of the app, if a popup appears stating 'Easy Accounting cannot be closed. Please close it manually and click Retry to continue,' please try [these instructions](#q-not-able-to-update-the-app) first otherwise follow these steps:

  1. Open 'Task Manager' by pressing `Ctrl + Shift + Esc`
  2. Scroll down to find tasks labelled as 'Easy Accounting'
  3. Select each task one by one and press 'End Task' button on bottom right side.

  This will resolve the issue.
  >

#### Q: Not able to update the app

- **(Windows)** During the installation of the app update, if a popup appears stating 'Easy Accounting cannot be closed. Please close it manually and click Retry to continue,' please follow these steps:

  1. Hover over the app's icon in the menu bar (located at the bottom).
  2. Click the cross icon (on the top right side) to close the previous instance of the application.
  3. Press the 'Retry' button on the setup dialog to continue with the installation.

  This will resolve the issue.
  >

#### Q: How to check renderer process logs in packaged app

- **(Mac)** Press `Cmd + Option + I` Or Go to 'View' Menu, and select 'Toggle Developer Tools' option.
- **(Windows)** Press `Ctrl + Alt + I`
  >

#### Q: How to check main process logs in packaged app

- (Mac Live) Open up terminal and Run this command to spin up the app, and logs will appear in the terminal window

```shell
/Applications/Easy\ Accounting.app/Contents/MacOS/Easy\ Accounting
```

- **(Mac)** check file `main.log` at path: `/Users/<username>/Library/Logs/easy-accounting.main.log`
- **(Windows)** check file `main.log` at path: `C:\Users\<username>\AppData\Roaming\easy-accounting\logs\main.log`
  >

#### Q: How to check current state of electron-store

- **(Mac)** check file `config.json` at path `/Users/<username>/Library/Application Support/easy-accounting/config.json`
- **(Windows)** check file `config.json` at path `C:\Users\<username>\AppData\Roaming\easy-accounting\config.json`
  >

#### Q: How to check db being used in packaged app

- **(Mac)** check file `database.db` at path `/Users/<username>/Library/Application Support/easy-accounting/database.db`
- **(Windows)** check directory `C:\Users\<username>\AppData\Roaming\easy-accounting\database.db`
  >

#### Q: How to check contents of packaged app (and resources exported as-it-is like migration files)

- **(Mac)** Open `Applications` directory, find the app, right click and select 'Show Package Contents' option, navigate to `Contents/Resources` directory
- **(Windows)** check directory `C:\Users\<username>\AppData\Local\Programs\easy-accounting`
  >
