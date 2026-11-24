const DB_NAME = 'deck-db';
const DB_VERSION = 4;
const METADATA = 'deckMetadata';
const BODIES = 'savedBodies';
const PROJECTS = 'savedProjects';

function result(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function scopeRange(source, scope) {
  return IDBKeyRange.bound([source, scope], [source, scope, []]);
}

export function createBrowserOfflineStore() {
  if (!globalThis.indexedDB) return undefined;

  let opening;
  function open() {
    opening ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      let blocked = false;
      request.onblocked = () => {
        blocked = true;
        reject(new Error('Close older Deck tabs to enable offline storage'));
      };
      request.onupgradeneeded = () => {
        const db = request.result;
        // Older versions stored every card and its locally generated search index.
        for (const name of ['cards', 'searchIndex']) {
          if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
        }
        db.createObjectStore(METADATA);
        db.createObjectStore(BODIES);
        db.createObjectStore(PROJECTS);
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) {
          db.close();
          return;
        }
        db.onversionchange = () => {
          db.close();
          opening = undefined;
        };
        resolve(db);
      };
    }).catch(error => {
      opening = undefined;
      throw error;
    });
    return opening;
  }

  async function transact(names, mode, run) {
    const db = await open();
    const tx = db.transaction(names, mode);
    const committed = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error ?? new Error('Offline storage transaction aborted'));
    });
    try {
      const value = await run(name => tx.objectStore(name));
      await committed;
      return value;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // The transaction may have already aborted.
      }
      await committed.catch(() => {});
      throw error;
    }
  }

  const read = (name, key) => transact(name, 'readonly', store => result(store(name).get(key)));
  const write = (name, key, record) =>
    transact(name, 'readwrite', store => store(name).put(record, key));

  function updateProject(source, records) {
    return transact([BODIES, PROJECTS], 'readwrite', store => {
      const bodies = store(BODIES);
      const projects = store(PROJECTS);
      bodies.delete(scopeRange(source, 'project'));
      if (!records) {
        projects.delete(source);
        return;
      }
      projects.put(true, source);
      for (const record of records) bodies.put(record, [source, 'project', record.path]);
    });
  }

  return {
    readMetadata: key => read(METADATA, key),
    writeMetadata: (key, value) => write(METADATA, key, value),
    readCard(source, path, hash) {
      return transact(BODIES, 'readonly', async store => {
        const bodies = store(BODIES);
        const saved = await Promise.all(
          ['card', 'project'].map(scope => result(bodies.get([source, scope, path]))),
        );
        return saved.find(record => record && (hash === undefined || record.hash === hash));
      });
    },
    status(source) {
      return transact([BODIES, PROJECTS], 'readonly', async store => {
        const [projectSaved, keys] = await Promise.all([
          result(store(PROJECTS).get(source)),
          result(store(BODIES).getAllKeys(scopeRange(source, 'card'))),
        ]);
        return {projectSaved: Boolean(projectSaved), cardPaths: keys.map(key => key[2])};
      });
    },
    writeCard: (source, record) => write(BODIES, [source, 'card', record.path], record),
    deleteCard: (source, path) =>
      transact(BODIES, 'readwrite', store => store(BODIES).delete([source, 'card', path])),
    writeProject: (source, records) => updateProject(source, records),
    deleteProject: source => updateProject(source),
  };
}
