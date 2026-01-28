/**
 * Module demonstrating arrow function patterns.
 */

export const add = (a: number, b: number): number => a + b;

export const multiply = (a: number, b: number): number => {
    return a * b;
};

export const greet = (name: string): string => {
    const greeting = `Hello, ${name}!`;
    console.log(greeting);
    return greeting;
};

export const processArray = <T>(items: T[], fn: (item: T) => T): T[] => {
    return items.map(fn);
};

export const createHandler = (prefix: string) => {
    return (message: string): string => {
        return `${prefix}: ${message}`;
    };
};

// Regular function for comparison
export function regularFunction(x: number): number {
    return x * 2;
}
