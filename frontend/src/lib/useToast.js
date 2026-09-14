import { useState, useRef, useEffect } from 'react';

export function useToast() {
  const [msg, setMsg] = useState('');
  const [show, setShow] = useState(false);
  const timer = useRef(null);

  const toast = (m) => {
    setMsg(m);
    setShow(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShow(false), 2600);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  return { msg, show, toast };
}
