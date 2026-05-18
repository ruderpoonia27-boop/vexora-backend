import dns from 'dns';

let configured = false;

export const configureDnsServers = () => {
  if (configured) return;

  const servers = (process.env.DNS_SERVERS || '')
    .split(',')
    .map((server) => server.trim())
    .filter(Boolean);

  if (servers.length > 0) {
    dns.setServers(servers);
    configured = true;
    console.log(`Custom DNS servers configured: ${servers.join(', ')}`);
  }
};
