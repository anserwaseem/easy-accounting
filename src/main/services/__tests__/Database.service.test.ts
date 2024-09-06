/* eslint-disable jest/no-commented-out-tests */

// import Database from 'better-sqlite3';
// import path from 'path';
// import * as DatabaseService from '../Database.service';

// jest.mock('better-sqlite3');

// // TODO: Enable this test
// // eslint-disable-next-line jest/no-disabled-tests
// describe.skip('Database Service', () => {
//   const mockDatabase = {
//     verbose: jest.fn(),
//     fileMustExist: true,
//   };
//   jest.spyOn(DatabaseService, 'isDevelopment');

//   beforeEach(() => {
//     jest.clearAllMocks();
//     (Database as unknown as jest.Mock).mockReturnValue(mockDatabase);
//   });

//   it('should use the correct database path in development environment', () => {
//     process.env.NODE_ENV = 'development';
//     (DatabaseService.isDevelopment as jest.Mock).mockReturnValue(true);

//     DatabaseService.connect();

//     expect(Database).toHaveBeenCalledWith(
//       expect.stringContaining(path.join('release', 'app', 'database.db')),
//       expect.any(Object),
//     );
//   });

//   it('should use the correct database path in production environment', () => {
//     process.env.NODE_ENV = 'production';
//     (DatabaseService.isDevelopment as jest.Mock).mockReturnValue(false);

//     DatabaseService.connect();

//     expect(Database).toHaveBeenCalledWith(
//       expect.stringMatching(
//         /^((?!release\/\/app|release\\app).)*database\.db$/,
//       ), // should not contain 'release/app' or 'release\\app' but should contain 'database.db'
//       expect.any(Object),
//     );
//   });

//   it('should always pass the correct options to Database constructor', () => {
//     DatabaseService.connect();

//     expect(Database).toHaveBeenCalledWith(expect.any(String), {
//       verbose: console.log,
//       fileMustExist: true,
//     });
//   });
// });
