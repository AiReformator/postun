// app.postun.org serves the cabinet from the same Pages build.
if (location.hostname.startsWith('app.') && location.pathname === '/') location.replace('/app/');
