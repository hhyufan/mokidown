let transition;

export function registerEditorPaneTransition(run) {
  transition = run;
  return () => {
    if (transition === run) transition = undefined;
  };
}

export function transitionEditorPane(update) {
  return transition ? transition(update) : update();
}
