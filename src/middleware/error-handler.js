function notFound(_req, res) {
  res.status(404).json({ code: 404, message: '接口不存在' });
}

function errorHandler(error, _req, res, _next) {
  console.error('[server error]', error);
  const status = error.status || 500;
  res.status(status).json({ code: status, message: status >= 500 ? '服务器开小差了，请稍后重试' : error.message });
}

module.exports = { notFound, errorHandler };
