/* SPDX-License-Identifier: GPL-3.0-only
 *
 * Copyright (C) 2022 ImmortalWrt.org
 */

'use strict';
'require form';
'require poll';
'require rpc';
'require uci';
'require validation';
'require view';
'require tools.homeproxy as hp';
'require tools.widgets as widgets';

var callServiceList = rpc.declare({
	object: 'service',
	method: 'list',
	params: ['name'],
	expect: { '': {} }
});

function getServiceStatus() {
	return L.resolveDefault(callServiceList('homeproxy'), {}).then(function (res) {
		var isRunning = false;
		try {
			isRunning = res['homeproxy']['instances']['sing-box']['running'];
		} catch (e) { }
		return isRunning;
	});
}

function renderStatus(isRunning) {
	var spanTemp = '<em><span style="color:%s"><strong>%s %s</strong></span></em>';
	var renderHTML;
	if (isRunning) {
		renderHTML = String.format(spanTemp, 'green', _('HomeProxy'), _('RUNNING'));
	} else {
		renderHTML = String.format(spanTemp, 'red', _('HomeProxy'), _('NOT RUNNING'));
	}

	return renderHTML;
}

function validatePortRange(section_id, value) {
	if (section_id && value) {
		value = value.match(/^(\d+)?\:(\d+)?$/);
		if (value && (value[1] || value[2])) {
			if (!value[1])
				value[1] = 0;
			else if (!value[2])
				value[2] = 65535;

			if (value[1] < value[2] && value[2] <= 65535)
				return true;
		}

		return _('Expecting: %s').format( _('valid port range (port1:port2)'));
	}

	return true;
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('homeproxy')
		]);
	},

	render: function(data) {
		var m, s, o, ss, so;

		m = new form.Map('homeproxy', _('HomeProxy'),
			_('The modern ImmortalWrt proxy platform for ARM64/AMD64. Powered by sing-box.'));

		s = m.section(form.TypedSection);
		s.anonymous = true;
		s.render = function () {
			poll.add(function () {
				return L.resolveDefault(getServiceStatus()).then(function (res) {
					var view = document.getElementById("service_status");
					view.innerHTML = renderStatus(res);
				});
			});

			return E('div', { class: 'cbi-section', id: 'status_bar' }, [
					E('p', { id: 'service_status' }, _('Collecting data...'))
			]);
		}

		/* Cache all configured proxy nodes, they will be called multiple times. */
		var proxy_nodes = {};
		uci.sections(data[0], 'node', function(res) {
			proxy_nodes[res['.name']] = 
				String.format('[%s] %s', res.type === 'v2ray' ? res.type + '/' + res.v2ray_protocol : res.type,
					res.label || res.server + ':' + res.server_port);
		});

		s = m.section(form.NamedSection, 'config', 'homeproxy');

		o = s.option(form.ListValue, 'main_server', _('Main server'));
		o.value('nil', _('Disable'));
		for (var i in proxy_nodes)
			o.value(i, proxy_nodes[i]);
		o.default = 'nil';
		o.depends({'routing_mode': 'custom', '!reverse': true});
		o.rmempty = false;

		o = s.option(form.ListValue, 'main_udp_server', _('Main UDP server'));
		o.value('nil', _('Disable'));
		o.value('same', _('Same as main server'));
		for (var i in proxy_nodes)
			o.value(i, proxy_nodes[i]);
		o.default = 'nil';
		o.depends({'routing_mode': 'custom', '!reverse': true});
		o.rmempty = false;

		o = s.option(form.ListValue, 'routing_mode', _('Routing mode'));
		o.value('gfwlist', _('GFWList'));
		o.value('bypass_mainland_china', _('Bypass mainland China'));
		o.value('proxy_mainland_china', _('Only proxy mainland China'));
		o.value('custom', _('Custom routing'));
		o.value('global', _('Global'));
		o.default = 'bypass_mainland_china';
		o.rmempty = false;

		o = s.option(form.Value, 'routing_port', _('Routing ports'),
			_('Specify target port(s) that get proxied. Multiple ports must be separated by commas.'));
		o.value('all', _('All ports'));
		o.value('common', _('Common ports only (bypass P2P traffic)'));
		o.default = 'common';
		o.depends({'routing_mode': 'custom', '!reverse': true});
		o.validate = function(section_id, value) {
			if (section_id && value !== 'all' && value !== 'common') {
				if (value === null || value === '')
					return _('Expecting: %s').format(_('valid port value'));

				var ports = [];
				for (var i of value.split(',')) {
					var port = parseInt(i);
					if (port.toString() == 'NaN' || port.toString() !== i || port < 1 || port > 65535)
						return _('Expecting: %s').format(_('valid port value'));
					if (ports.includes(i))
						return _('Port %s alrealy exists, please enter other ones.').format(port);
					ports = ports.concat(i);
				}
			}

			return true;
		}

		o = s.option(form.Value, 'dns_server', _('DNS server'),
			_('You can only have one server set. Custom DNS server format as plain IPv4/IPv6.'));
		o.value('local', _('Follow system'));
		o.value('wan', _('Use DNS server from WAN'));
		o.value('1.1.1.1', _('CloudFlare Public DNS (1.1.1.1)'));
		o.value('208.67.222.222', _('Cisco Public DNS (208.67.222.222)'));
		o.value('8.8.8.8', _('Google Public DNS (8.8.8.8)'));
		o.value('', _('---'));
		o.value('223.5.5.5', _('Aliyun Public DNS (223.5.5.5)'));
		o.value('119.29.29.29', _('Tencent Public DNS (119.29.29.29)'));
		o.value('114.114.114.114', _('Xinfeng Public DNS (114.114.114.114)'));
		o.default = '8.8.8.8';
		o.depends({'routing_mode': 'custom', '!reverse': true});
		o.validate = function(section_id, value) {
			if (!['local', 'wan'].includes(value)
					&& !(validation.parseIPv4(value) || validation.parseIPv6(value)))
				return _('Expecting: %s').format(_('valid IP address'));

			return true;
		}

		o = s.option(form.SectionValue, '_routing', form.NamedSection, 'routing', 'homeproxy', _('Routing settings'));
		o.depends('routing_mode', 'custom');

		ss = o.subsection;
		so = ss.option(form.Flag, 'sniff_override', _('Override destination'),
			_('Override the connection destination address with the sniffed domain.'));
		so.default = so.enabled;
		so.rmempty = false;

		so = ss.option(form.ListValue, 'default_outbound', _('Default outbound'));
		so.load = function(section_id) {
			delete this.keylist;
			delete this.vallist;

			var _this = this;
			_this.value('nil', _('Disable'));
			_this.value('direct-out', _('Direct'));
			_this.value('block-out', _('Block'));
			uci.sections(data[0], 'routing_node', function(res) {
				if (res.enabled === '1')
					_this.value(res.node, res.label);
			});

			return this.super('load', section_id);
		}
		so.default = 'nil';
		so.rmempty = false;

		so = ss.option(widgets.DeviceSelect, 'default_interface', _('Default interface'),
			_('Bind outbound connections to the specified NIC by default.<br/>Auto detect if leave empty.'));
		so.multiple = false;
		so.noaliases = true;
		so.nobridges = true;

		o = s.option(form.SectionValue, '_routing_node', form.GridSection, 'routing_node', _('Routing nodes'));
		o.depends('routing_mode', 'custom');

		ss = o.subsection;
		ss.addremove = true;
		ss.anonymous = true;
		ss.nodescriptions = true;
		ss.sortable = true;
		ss.modaltitle = function(section_id) {
			var label = uci.get(data[0], section_id, 'label');
			return label ? _('Routing node') + ' » ' + label : _('Add a routing node');
		}

		so = ss.option(form.Value, 'label', _('Label'));
		so.validate = L.bind(hp.validateUniqueValue, this, data[0], 'routing_node', 'label');

		so = ss.option(form.Flag, 'enabled', _('Enable'));
		so.rmempty = false;
		so.editable = true;

		so = ss.option(form.ListValue, 'node', _('Node'));
		for (var i in proxy_nodes)
			so.value(i + '-out', proxy_nodes[i]);
		so.validate = function(section_id, value) {
			if (section_id) {
				if (value === null || value === '')
					return _('Expecting: %s').format(_('non-empty value'));
				else {
					var duplicate = false;
					uci.sections(data[0], 'routing_node', function(res) {
						if (res['.name'] !== section_id)
							if (res.node === value)
								duplicate = true
					});
					if (duplicate)
						return _('This node was already taken.');
				}
			}

			return true;
		}

		so = ss.option(form.ListValue, 'domain_strategy', _('Domain strategy'),
			_('If set, the server domain name will be resolved to IP before connecting.<br/>dns.strategy will be used if empty.'));
		so.value('', _('Default'));
		so.value('prefer_ipv4', _('Prefer IPv4'));
		so.value('prefer_ipv6', _('Prefer IPv6'));
		so.value('ipv4_only', _('IPv4 only'));
		so.value('ipv6_only', _('IPv6 only'));
		so.modalonly = true;

		so = ss.option(widgets.DeviceSelect, 'bind_interface', _('Bind interface'),
			_('The network interface to bind to.'));
		so.multiple = false;
		so.noaliases = true;
		so.nobridges = true;
		so.modalonly = true;

		so = ss.option(form.ListValue, 'outbound', _('Outbound'),
			_('The tag of the upstream outbound.<br/>Other dial fields will be ignored when enabled.'));
		so.load = function(section_id) {
			delete this.keylist;
			delete this.vallist;

			var _this = this;
			_this.value('', _('Default'))
			_this.value('direct-out', _('Direct'))
			uci.sections(data[0], 'routing_node', function(res) {
				if (res['.name'] !== section_id && res.enabled === '1')
					_this.value(res.node, res.label);
			});

			return this.super('load', section_id);
		}
		so.validate = function(section_id, value) {
			if (section_id && value) {
				var node = this.map.lookupOption('node', section_id)[0].formvalue(section_id);

				var conflict = false;
				uci.sections(data[0], 'routing_node', function(res) {
					if (res['.name'] !== section_id)
						if (res.outbound === node && res.node == value)
							conflict = true;
				});
				if (conflict)
					return _('Recursive outbound detected!');
			}

			return true;
		}

		o = s.option(form.SectionValue, '_routing_rule', form.GridSection, 'routing_rule', _('Routing rules'));
		o.depends('routing_mode', 'custom');

		ss = o.subsection;
		ss.addremove = true;
		ss.anonymous = true;
		ss.nodescriptions = true;
		ss.sortable = true;
		ss.modaltitle = function(section_id) {
			var label = uci.get(data[0], section_id, 'label');
			return label ? _('Routing rule') + ' » ' + label : _('Add a routing rule');
		}

		so = ss.option(form.Value, 'label', _('Label'));
		so.validate = L.bind(hp.validateUniqueValue, this, data[0], 'routing_rule', 'label');

		so = ss.option(form.Flag, 'enabled', _('Enable'));
		so.default = so.disabled;
		so.rmempty = false;
		so.editable = true;

		so = ss.option(form.ListValue, 'ip_version', _('IP version'),
			_('4 or 6. Not limited if empty.'));
		so.value('4', _('IPv4'));
		so.value('6', _('IPv6'));
		so.value('', _('Both'));
		so.modalonly = true;

		so = ss.option(form.ListValue, 'mode', _('Mode'),
			_('The default rule uses the following matching logic:<br/>' +
			'<code>(domain || domain_suffix || domain_keyword || domain_regex || geosite || geoip || ip_cidr)</code> &&<br/>' +
			'<code>(source_geoip || source_ip_cidr)</code> &&<br/>' +
			'<code>other fields</code>.'));
		so.value('default', _('Default'));
		so.value('and', _('And'));
		so.value('or', _('Or'));
		so.default = 'default';
		so.rmempty = false;

		so = ss.option(form.Flag, 'invert', _('Invert'),
			_('Invert match result.'));
		so.default = so.disabled;
		so.rmempty = false;
		so.modalonly = true;

		so = ss.option(form.ListValue, 'network', _('Network'));
		so.value('tcp', _('TCP'));
		so.value('udp', _('UDP'));
		so.value('', _('Both'));

		so = ss.option(form.MultiValue, 'protocol', _('Protocol'),
			_('Sniffed protocol, see <a target="_blank" href="https://sing-box.sagernet.org/configuration/route/sniff/">Sniff</a> for details.'));
		so.value('http', _('HTTP'));
		so.value('tls', _('TLS'));
		so.value('quic', _('QUIC'));
		so.value('stun', _('STUN'));

		so = ss.option(form.DynamicList, 'domain', _('Domain name'),
			_('Match full domain.'));
		so.datatype = 'hostname';
		so.modalonly = true;

		so = ss.option(form.DynamicList, 'domain_suffix', _('Domain suffix'),
			_('Match domain suffix.'));
		so.modalonly = true;

		so = ss.option(form.DynamicList, 'domain_keyword', _('Domain keyword'),
			_('Match domain using keyword.'));
		so.modalonly = true;

		so = ss.option(form.DynamicList, 'domain_regex', _('Domain regex'),
			_('Match domain using regular expression.'));
		so.modalonly = true;

		so = ss.option(form.DynamicList, 'geosite', _('Geosite'),
			_('Match geosite.'));
		so.modalonly = true;

		so = ss.option(form.DynamicList, 'source_geoip', _('Source GeoIP'),
			_('Match source geoip.'));
		so.modalonly = true;

		so = ss.option(form.DynamicList, 'geoip', _('GeoIP'),
			_('Match geoip.'));
		so.modalonly = true;

		so = ss.option(form.DynamicList, 'source_ip_cidr', _('Source IP CIDR'),
			_('Match source ip cidr.'));
		so.modalonly = true;

		so = ss.option(form.DynamicList, 'ip_cidr', _('IP CIDR'),
			_('Match ip cidr.'));
		so.modalonly = true;

		so = ss.option(form.DynamicList, 'source_port', _('Source port'),
			_('Match source port.'));
		so.datatype = 'port';
		so.modalonly = true;

		so = ss.option(form.DynamicList, 'source_port_range', _('Source port range'),
			_('Match source port range. Format as START:/:END/START:END.'));
		so.validate = validatePortRange;
		so.modalonly = true;

		so = ss.option(form.DynamicList, 'port', _('Port'),
			_('Match port.'));
		so.datatype = 'port';
		so.modalonly = true;

		so = ss.option(form.DynamicList, 'port_range', _('Port range'),
			_('Match port range. Format as START:/:END/START:END.'));
		so.validate = validatePortRange;
		so.modalonly = true;

		so = ss.option(form.DynamicList, 'process_name', _('Process name'),
			_('Match process name.'));
		so.modalonly = true;

		so = ss.option(form.DynamicList, 'user', _('User'),
			_('Match user name.'));
		so.modalonly = true;

		so = ss.option(form.ListValue, 'outbound', _('Outbound'),
			_('Tag of the target outbound.'));
		so.load = function(section_id) {
			delete this.keylist;
			delete this.vallist;

			var _this = this;
			_this.value('direct-out', _('Direct'));
			_this.value('block-out', _('Block'));
			uci.sections(data[0], 'routing_node', function(res) {
				if (res.enabled === '1')
					_this.value(res.node, res.label);
			});

			return this.super('load', section_id);
		}
		so.rmempty = false;

		o = s.option(form.SectionValue, '_dns', form.NamedSection, 'dns', 'homeproxy', _('DNS settings'));
		o.depends('routing_mode', 'custom');

		ss = o.subsection;

		so = ss.option(form.ListValue, 'dns_strategy', _('DNS strategy'),
			_('The DNS strategy for resolving the domain name in the address.'));
		so.value('prefer_ipv4', _('Prefer IPv4'));
		so.value('prefer_ipv6', _('Prefer IPv6'));
		so.value('ipv4_only', _('IPv4 only'));
		so.value('ipv6_only', _('IPv6 only'));
		so.default = 'prefer_ipv4';
		so.rmempty = false;

		so = ss.option(form.ListValue, 'default_server', _('Default DNS server'));
		so.load = function(section_id) {
			delete this.keylist;
			delete this.vallist;

			var _this = this;
			_this.value('local-dns', _('System DNS resolver'));
			uci.sections(data[0], 'dns_server', function(res) {
				if (res.enabled === '1')
					_this.value(res['.name'] + '-dns', res.label);
			});

			return this.super('load', section_id);
		}
		so.default = 'local-dns';
		so.rmempty = false;

		so = ss.option(form.Flag, 'disable_cache', _('Disable DNS cache'));
		so.default = so.disabled;
		so.rmempty = false;

		so = ss.option(form.Flag, 'disable_cache_expire', _('Disable cache expire'));
		so.default = so.disabled;
		so.depends('disable_cache', '0');
		so.rmempty = false;

		o = s.option(form.SectionValue, '_dns_server', form.GridSection, 'dns_server', _('DNS servers'));
		o.depends('routing_mode', 'custom');

		ss = o.subsection;
		ss.addremove = true;
		ss.anonymous = true;
		ss.nodescriptions = true;
		ss.sortable = true;
		ss.modaltitle = function(section_id) {
			var label = uci.get(data[0], section_id, 'label');
			return label ? _('DNS server') + ' » ' + label : _('Add a DNS server');
		}

		so = ss.option(form.Value, 'label', _('Label'));
		so.validate = L.bind(hp.validateUniqueValue, this, data[0], 'dns_server', 'label');

		so = ss.option(form.Flag, 'enabled', _('Enable'));
		so.default = so.disabled;
		so.rmempty = false;
		so.editable = true;

		so = ss.option(form.Value, 'address', _('Address'),
			_('The address of the dns server. Support UDP, TCP, DoT, DoH and RCode.'));
		so.rmempty = false;

		so = ss.option(form.ListValue, 'address_resolver', _('Address resolver'),
			_('Tag of a another server to resolve the domain name in the address. Required if address contains domain.'));
		so.load = function(section_id) {
			delete this.keylist;
			delete this.vallist;

			var _this = this;
			_this.value('', _('None'));
			_this.value('local-dns', _('System DNS resolver'));
			uci.sections(data[0], 'dns_server', function(res) {
				if (res['.name'] !== section_id && res.enabled === '1')
					_this.value(res['.name'] + '-dns', res.label);
			});

			return this.super('load', section_id);
		}
		so.validate = function(section_id, value) {
			if (section_id && value) {
				var conflict = false;
				uci.sections(data[0], 'dns_server', function(res) {
					if (res['.name'] !== section_id)
						if (res.address_resolver === section_id + '-dns' && res['.name'] + '-dns' == value)
							conflict = true;
				});
				if (conflict)
					return _('Recursive resolver detected!');
			}

			return true;
		}
		so.modalonly = true;

		so = ss.option(form.ListValue, 'address_strategy', _('Address strategy'),
			_('The domain strategy for resolving the domain name in the address. dns.strategy will be used if empty.'));
		so.value('', _('Default'));
		so.value('prefer_ipv4', _('Prefer IPv4'));
		so.value('prefer_ipv6', _('Prefer IPv6'));
		so.value('ipv4_only', _('IPv4 only'));
		so.value('ipv6_only', _('IPv6 only'));

		so = ss.option(form.ListValue, 'outbound', _('Outbound'),
			_('Tag of an outbound for connecting to the dns server.'));
		so.load = function(section_id) {
			delete this.keylist;
			delete this.vallist;

			var _this = this;
			_this.value('direct-out', _('Direct'));
			uci.sections(data[0], 'routing_node', function(res) {
				if (res.enabled === '1')
					_this.value(res.node, res.label);
			});

			return this.super('load', section_id);
		}
		so.default = 'direct-out';
		so.rmempty = false;

		o = s.option(form.SectionValue, '_dns_rule', form.GridSection, 'dns_rule', _('DNS rules'));
		o.depends('routing_mode', 'custom');

		ss = o.subsection;
		ss.addremove = true;
		ss.anonymous = true;
		ss.nodescriptions = true;
		ss.sortable = true;
		ss.modaltitle = function(section_id) {
			var label = uci.get(data[0], section_id, 'label');
			return label ? _('DNS rule') + ' » ' + label : _('Add a DNS rule');
		}

		so = ss.option(form.Value, 'label', _('Label'));
		so.validate = L.bind(hp.validateUniqueValue, this, data[0], 'dns_rule', 'label');

		so = ss.option(form.Flag, 'enabled', _('Enable'));
		so.default = so.disabled;
		so.rmempty = false;
		so.editable = true;

		so = ss.option(form.ListValue, 'mode', _('Mode'),
			_('The default rule uses the following matching logic:<br/>' +
			'<code>(domain || domain_suffix || domain_keyword || domain_regex || geosite || ip_cidr)</code> &&<br/>' +
			'<code>(source_geoip || source_ip_cidr)</code> &&<br/>' +
			'<code>other fields</code>.'));
		so.value('default', _('Default'));
		so.value('and', _('And'));
		so.value('or', _('Or'));
		so.default = 'default';
		so.rmempty = false;

		so = ss.option(form.Flag, 'invert', _('Invert'),
			_('Invert match result.'));
		so.default = so.disabled;
		so.rmempty = false;
		so.modalonly = true;

		so = ss.option(form.ListValue, 'network', _('Network'));
		so.value('tcp', _('TCP'));
		so.value('udp', _('UDP'));
		so.value('', _('Both'));

		so = ss.option(form.MultiValue, 'protocol', _('Protocol'),
			_('Sniffed protocol, see <a target="_blank" href="https://sing-box.sagernet.org/configuration/route/sniff/">Sniff</a> for details.'));
		so.value('http', _('HTTP'));
		so.value('tls', _('TLS'));
		so.value('quic', _('QUIC'));
		so.value('dns', _('DNS'));
		so.value('stun', _('STUN'));

		so = ss.option(form.DynamicList, 'domain', _('Domain name'),
			_('Match full domain.'));
		so.datatype = 'hostname';
		so.modalonly = true;

		so = ss.option(form.DynamicList, 'domain_suffix', _('Domain suffix'),
			_('Match domain suffix.'));
		so.modalonly = true;

		so = ss.option(form.DynamicList, 'domain_keyword', _('Domain keyword'),
			_('Match domain using keyword.'));
		so.modalonly = true;

		so = ss.option(form.DynamicList, 'domain_regex', _('Domain regex'),
			_('Match domain using regular expression.'));
		so.modalonly = true;

		so = ss.option(form.DynamicList, 'geosite', _('Geosite'),
			_('Match geosite.'));
		so.modalonly = true;

		so = ss.option(form.DynamicList, 'source_geoip', _('Source GeoIP'),
			_('Match source geoip.'));
		so.modalonly = true;

		so = ss.option(form.DynamicList, 'source_ip_cidr', _('Source IP CIDR'),
			_('Match source ip cidr.'));
		so.modalonly = true;

		so = ss.option(form.DynamicList, 'ip_cidr', _('IP CIDR'),
			_('Match ip cidr.'));
		so.modalonly = true;

		so = ss.option(form.DynamicList, 'source_port', _('Source port'),
			_('Match source port.'));
		so.datatype = 'port';
		so.modalonly = true;

		so = ss.option(form.DynamicList, 'source_port_range', _('Source port range'),
			_('Match source port range. Format as START:/:END/START:END.'));
		so.validate = validatePortRange;
		so.modalonly = true;

		so = ss.option(form.DynamicList, 'port', _('Port'),
			_('Match port.'));
		so.datatype = 'port';
		so.modalonly = true;

		so = ss.option(form.DynamicList, 'port_range', _('Port range'),
			_('Match port range. Format as START:/:END/START:END.'));
		so.validate = validatePortRange;
		so.modalonly = true;

		so = ss.option(form.DynamicList, 'process_name', _('Process name'),
			_('Match process name.'));
		so.modalonly = true;

		so = ss.option(form.DynamicList, 'user', _('User'),
			_('Match user name.'));
		so.modalonly = true;

		so = ss.option(form.MultiValue, 'outbound', _('Outbound'),
			_('Match outbound.'));
		so.load = function(section_id) {
			delete this.keylist;
			delete this.vallist;

			var _this = this;
			_this.value('direct-out', _('Direct'));
			_this.value('block-out', _('Block'));
			uci.sections(data[0], 'routing_node', function(res) {
				if (res.enabled === '1')
					_this.value(res.node, res.label);
			});

			return this.super('load', section_id);
		}
		so.modalonly = true;

		so = ss.option(form.ListValue, 'server', _('Server'),
			_('Tag of the target dns server.'));
		so.load = function(section_id) {
			delete this.keylist;
			delete this.vallist;

			var _this = this;
			_this.value('local-dns', _('System DNS resolver'));
			_this.value('block-dns', _('Block DNS queries'));
			uci.sections(data[0], 'dns_server', function(res) {
				if (res.enabled === '1')
					_this.value(res['.name'] + '-dns', res.label);
			});

			return this.super('load', section_id);
		}
		so.rmempty = false;

		so = ss.option(form.Flag, 'dns_disable_cache', _('Disable dns cache'),
			_('Disable cache and save cache in this query.'));
		so.default = so.disabled;
		so.rmempty = false;
		so.modalonly = true;

		return m.render();
	}
});
