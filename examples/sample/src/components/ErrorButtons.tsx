function throwInHandler() {
  throw new Error('Sample error thrown from a click handler');
}

function rejectPromise() {
  void Promise.reject(new Error('Sample unhandled promise rejection'));
}

export function ErrorButtons() {
  return (
    <div className="actions">
      <button className="button danger" type="button" onClick={throwInHandler}>
        Throw error
      </button>
      <button className="button danger" type="button" onClick={rejectPromise}>
        Reject promise
      </button>
    </div>
  );
}
