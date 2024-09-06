export default {
  name: '007_add_entry_todos',
  up: (db) => {
    db.prepare(
      `
      INSERT INTO todos (task) VALUES ('This is a dummy todo added in migration number 007');
      `,
    ).run();
  },
};
