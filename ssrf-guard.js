/*
 * Destination guard for the proxy.
 *
 * The original code only ran a prefix regex against the hostname string
 * (/^(10\.|192\.|127\.|localhost$)/), which misses 169.254.169.254 (cloud
 * metadata), 172.16.0.0/12, IPv6 loopback/ULA, "localhost." with a trailing
 * dot, DNS names that resolve into private space, and DNS rebinding.
 *
 * This module resolves the hostname at connect time, rejects the request if
 * ANY resolved address is non-public, and pins the connection to the address
 * that was checked.
 */
var dns = require('dns');
var ipaddr = require('ipaddr.js');

var PUBLIC_RANGE = 'unicast';

function isForbiddenAddress(address) {
    if (!ipaddr.isValid(address)) {
        return true; // fail closed
    }

    var addr = ipaddr.parse(address);
    if (addr.kind() === 'ipv6' && addr.isIPv4MappedAddress()) {
        addr = addr.toIPv4Address();
    }

    // ipaddr.js classifies private, loopback, linkLocal, uniqueLocal,
    // unspecified, multicast, reserved and carrierGradeNat separately.
    return addr.range() !== PUBLIC_RANGE;
}

function ssrfError(address) {
    var err = new Error('destination address is not allowed: ' + address);
    err.code = 'ESSRF';
    return err;
}

// `lookup` hook for http.request(): resolves once, validates every answer,
// and hands back a pinned address.
function safeLookup(hostname, options, callback) {
    dns.lookup(hostname, {all: true}, function (err, addresses) {
        if (err) {
            return callback(err);
        }
        if (!addresses || addresses.length === 0) {
            return callback(ssrfError(hostname));
        }
        for (var i = 0; i < addresses.length; i++) {
            if (isForbiddenAddress(addresses[i].address)) {
                return callback(ssrfError(addresses[i].address));
            }
        }
        callback(null, addresses[0].address, addresses[0].family);
    });
}

module.exports = {
    isForbiddenAddress: isForbiddenAddress,
    safeLookup: safeLookup
};
