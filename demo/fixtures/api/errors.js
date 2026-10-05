// Validation failures leave the service in this shape. Everything that renders
// an error downstream has been reading `message` straight off the body since.
function flat422(field, message) {
  return { status: 422, field, message };
}

function validateCreate(body) {
  if (!body.name) return flat422('name', 'name is required');
  if (!body.region) return flat422('region', 'region is required');
  return null;
}

module.exports = { flat422, validateCreate };
