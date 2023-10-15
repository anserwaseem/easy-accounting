import { useState } from 'react';
import styles from './Modal.module.css';
import { TODO } from '../TaskArea';
import { Button } from 'renderer/shad/ui/button';
export type Modal = {
  initialData: TODO | undefined;
  onClose: () => void;
  onSave: (item: TODO) => void;
};

export default function Modal({ onClose, initialData, onSave }: Modal) {
  const [title, setTitle] = useState(initialData?.title || '');

  function handleOnSave() {
    if (title === '') {
      alert('Invalid title');
      return;
    }

    onSave({
      title,
      date: initialData?.date || new Date().toJSON(),
      status: initialData?.status || 0,
      id: initialData?.id,
    });
  }

  return (
    <div className={styles.modal}>
      <div className={styles.modal_content}>
        <span className={styles.close} onClick={onClose}>
          &times;
        </span>
        <h2 className="text-2xl">New task</h2>
        <div className={styles.formGroup}>
          <label>Title</label>
          <input value={title} onChange={(el) => setTitle(el.target.value)} />
        </div>
        <Button variant="default" onClick={handleOnSave} className="mr-2">
          Save
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
