export default driver => {
  const prop$ = driver.property('Text');

  driver.panel('My Panel', (container, signal) => {
    const sub = prop$.subscribe(text => {
      container.replaceChildren(text);
    });

    signal.addEventListener('abort', () => {
      sub.unsubscribe();
    });
  });
};
