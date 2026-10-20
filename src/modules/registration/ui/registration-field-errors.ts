export function registrationFieldErrors(form: HTMLFormElement): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const element of Array.from(form.elements)) {
    if (!(
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement
    ))
      continue;
    if (!element.name || !element.willValidate) continue;
    const blank = element.required && element.type !== 'checkbox' && element.value.trim() === '';
    if (element.validity.valid && !blank) continue;
    errors[element.name] =
      element.type === 'checkbox'
        ? 'Please accept the waiver to continue.'
        : element.validity.valueMissing || blank
          ? element instanceof HTMLSelectElement
            ? 'Please choose an option.'
            : 'This field is required.'
          : element.validity.typeMismatch && element.type === 'email'
            ? 'Enter a valid email address.'
            : 'Please enter a valid value.';
  }
  return errors;
}
