/* eslint-disable no-redeclare */
import log from 'electron-log';

/**
 * A class-level decorator to log errors for all methods of the class.
 *
 * @param constructor - The constructor function of the class.
 */
export function logErrors(constructor: Function): void;

/**
 * A decorator function to log errors for the decorated method.
 *
 * @param target - The prototype of the class for an instance member or the constructor function of the class for a static member.
 * @param propertyName - The name of the method being decorated.
 * @param descriptor - The property descriptor for the method.
 * @returns The modified property descriptor with error logging functionality.
 */
export function logErrors(
  target: any,
  propertyName: string,
  descriptor: PropertyDescriptor,
): PropertyDescriptor;

/**
 * Implementation of the overloaded logErrors function.
 */
export function logErrors(
  targetOrConstructor: any,
  propertyName?: string,
  descriptor?: PropertyDescriptor,
): PropertyDescriptor | void {
  if (typeof targetOrConstructor === 'function') {
    // Class-level decorator
    const constructor = targetOrConstructor;
    const methodNames = Object.getOwnPropertyNames(
      constructor.prototype,
    ).filter(
      (name) =>
        name !== 'constructor' &&
        typeof constructor.prototype[name] === 'function',
    );

    // attach logger to each method
    for (const methodName of methodNames) {
      const methodDescriptor = Object.getOwnPropertyDescriptor(
        constructor.prototype,
        methodName,
      );
      if (methodDescriptor) {
        Object.defineProperty(
          constructor.prototype,
          methodName,
          logErrors(constructor.prototype, methodName, methodDescriptor),
        );
      }
    }
  } else {
    // Method-level decorator
    const method = descriptor!.value; // the original method

    // wrapping original method
    descriptor!.value =
      // eslint-disable-next-line func-names
      function (...args: any[]) {
        try {
          return method.apply(this, args); // try to execute the original method with the provided arguments
        } catch (error) {
          log.error(`Error in ${propertyName}: `, error);
          throw error; // re-throw the error after logging it to ensure the error is not silently swallowed
        }
      };

    return descriptor!; // return the modified descriptor which now includes the error logging functionality
  }
}
