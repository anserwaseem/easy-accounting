# Easy Accounting

Easy Accounting is a comprehensive, user-friendly accounting software designed for small to medium-sized businesses. Built with React and Electron, it offers a seamless desktop experience across various platforms. The application leverages Better-sqlite for efficient data management and React Router for smooth navigation within the app.

## Features

- **Cross-Platform Support**: Runs on Windows, macOS, and Linux.
- **User-Friendly Interface**: Intuitive design for easy navigation and operation.
- **Data Management**: Utilizes Better-sqlite for secure and efficient data storage.
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
npm run build
```

This will compile the application and generate executable according to your OS in the **release** folder

## FAQs

- **Q: Automatic linting and testing not working**
  - Run `npx mrm lint-staged` to setup _husky_ in your system.
