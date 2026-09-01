export class SoundCycle<T> {
	readonly #values: readonly T[];
	#index = 0;

	constructor(values: readonly T[]) {
		if (values.length === 0) throw new Error("Sound cycle cannot be empty");
		this.#values = values;
	}

	next(): T {
		const value = this.#values[this.#index];
		if (value === undefined) throw new Error("Sound cycle index is out of bounds");
		this.#index = (this.#index + 1) % this.#values.length;
		return value;
	}
}
