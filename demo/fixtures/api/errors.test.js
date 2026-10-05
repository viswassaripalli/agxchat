const { validateCreate } = require('./errors');

test('missing name is a 422 naming the field', () => {
  const err = validateCreate({ region: 'eu' });
  expect(err.status).toBe(422);
  expect(err.field).toBe('name');
  expect(err.message).toBe('name is required');
});
