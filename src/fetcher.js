import { Provider } from '@3sln/ngin';

export class ThrottledFetcher {
    #queue = [];
    #activeRequests = 0;
    #concurrency;

    constructor(concurrency = 6) {
        this.#concurrency = concurrency;
    }

    fetch(url, options) {
        return new Promise((resolve, reject) => {
            this.#queue.push({ url, options, resolve, reject });
            this.#processQueue();
        });
    }

    #processQueue() {
        if (this.#activeRequests >= this.#concurrency || this.#queue.length === 0) {
            return;
        }

        this.#activeRequests++;
        const { url, options, resolve, reject } = this.#queue.shift();

        fetch(url, options)
            .then(response => resolve(response))
            .catch(error => reject(error))
            .finally(() => {
                this.#activeRequests--;
                this.#processQueue();
            });
    }
}
