import type { ApplicationDTO } from '@ensembleui/react-framework';

import MenuYAML from './screens/menu.yaml';

import HomeYAML from './screens/home.yaml';
import NoteYAML from './widgets/note.yaml';

export const notesApp: ApplicationDTO = {
  id: 'myNotesApp',
  name: 'My Notes',
  screens: [
    {
      id: 'menu',
      name: 'Menu',
      content: MenuYAML,
    },
    {
      id: 'home',
      name: 'Home',
      content: HomeYAML,
    },
  ],
  widgets: [
    {
      id: 'note',
      name: 'Note',
      content: NoteYAML,
    },
  ],
  scripts: [],
};
