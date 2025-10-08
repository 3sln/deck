/*
This module is a generic, singleton HMR runner. It manages the state for
multiple instances of multiple inner modules.

It uses a Map of Maps to track module states: Map<uri, Map<instanceKey, state>>.

When a dependency changes, Vite HMR reloads this runner. The runner preserves
its state map across reloads. After reloading, it iterates through all tracked
module instances, re-imports them, compares the new module with the old one,
and re-executes the module's default export with its preserved arguments if
the module has changed.
*/

let managedModules = new Map();

// Restore state on HMR reload
if (import.meta.hot?.data.managedModules) {
    managedModules = import.meta.hot.data.managedModules;
}

async function run(uri, instanceKey, ...args) {
    if (!managedModules.has(uri)) {
        managedModules.set(uri, new Map());
    }
    const instances = managedModules.get(uri);

    const url = new URL(uri, location.href);
    const module = await import(/* @vite-ignore */ url.toString());

    instances.set(instanceKey, {
        args,
        lastModule: module
    });

    if (module.default && typeof module.default === 'function') {
        module.default(...args);
    }
}

export default run;

export function purge(uri, instanceKey) {
    const instances = managedModules.get(uri);
    if (instances) {
        instances.delete(instanceKey);
        if (instances.size === 0) {
            managedModules.delete(uri);
        }
    }
}

if (import.meta.hot) {
    // Preserve state across HMR updates
    import.meta.hot.dispose(data => {
        data.managedModules = managedModules;
    });

    // Re-run changed modules after the runner itself has been updated
    import.meta.hot.accept(async () => {
        for (const [uri, instances] of managedModules.entries()) {
            for (const [instanceKey, state] of instances.entries()) {
                const { args, lastModule } = state;
                const url = new URL(uri, location.href);
                const newModule = await import(/* @vite-ignore */ url.toString());

                if (newModule.default !== lastModule.default) {
                    console.log(`HMR reloading: ${uri}`);
                    run(uri, instanceKey, ...args);
                }
            }
        }
    });
}