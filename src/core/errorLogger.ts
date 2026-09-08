/* eslint-disable no-redeclare */
import { getCoreLogger } from './ports';

/**
 * Error-logging decorator for core services — the async-aware sibling of
 * src/main/errorLogger.ts. Logs through the injected core logger (see
 * setCoreLogger), so it works on any platform. Handles both sync throws and
 * rejected promises, since core service methods are async.
 */
export function logErrors(constructor: Function): void;
export function logErrors(
  target: any,
  propertyName: string,
  descriptor: PropertyDescriptor,
): PropertyDescriptor;
export function logErrors(
  targetOrConstructor: any,
  propertyName?: string,
  descriptor?: PropertyDescriptor,
): PropertyDescriptor | void {
  if (typeof targetOrConstructor === 'function') {
    const constructor = targetOrConstructor;
    const methodNames = Object.getOwnPropertyNames(
      constructor.prototype,
    ).filter(
      (name) =>
        name !== 'constructor' &&
        typeof constructor.prototype[name] === 'function',
    );

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
    const method = descriptor!.value;

    descriptor!.value =
      // eslint-disable-next-line func-names
      function (...args: any[]) {
        try {
          const result = method.apply(this, args);
          if (result instanceof Promise) {
            return result.catch((error: unknown) => {
              getCoreLogger().error(`Error in ${propertyName}: `, error);
              throw error;
            });
          }
          return result;
        } catch (error) {
          getCoreLogger().error(`Error in ${propertyName}: `, error);
          throw error;
        }
      };

    return descriptor!;
  }
}
