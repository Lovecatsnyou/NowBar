// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
const MPRIS_PATH = '/org/mpris/MediaPlayer2';
const PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';
const PROPERTIES_IFACE = 'org.freedesktop.DBus.Properties';

function getProperty(proxy, name, fallback = null) {
    const value = proxy.get_cached_property(name);
    return value === null ? fallback : value.recursiveUnpack();
}

export class MprisManager {
    constructor(onChanged) {
        this._onChanged = onChanged;
        this._players = new Map();
        this._lastActiveName = null;
        this._nameOwnerChangedId = 0;

        this._watchBus();
        this._discoverPlayers();
    }

    get currentMedia() {
        const selected = this._selectCurrentPlayer();
        if (!selected)
            return null;

        const {proxy} = selected;
        const metadata = getProperty(proxy, 'Metadata', {});
        const artists = metadata['xesam:artist'] ?? [];

        return {
            status: getProperty(proxy, 'PlaybackStatus', 'Stopped'),
            title: metadata['xesam:title'] ?? '',
            artist: Array.isArray(artists) ? artists.join(', ') : artists,
            album: metadata['xesam:album'] ?? '',
            artUrl: metadata['mpris:artUrl'] ?? '',
            trackId: metadata['mpris:trackid'] ?? '',
            length: Number(metadata['mpris:length'] ?? 0),
            canSeek: getProperty(proxy, 'CanSeek', false),
        };
    }

    getPosition(callback) {
        const selected = this._selectCurrentPlayer();
        if (!selected) {
            callback(0);
            return;
        }

        Gio.DBus.session.call(
            selected.name,
            MPRIS_PATH,
            PROPERTIES_IFACE,
            'Get',
            new GLib.Variant('(ss)', [PLAYER_IFACE, 'Position']),
            new GLib.VariantType('(v)'),
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (connection, result) => {
                try {
                    const [position] = connection.call_finish(result).recursiveUnpack();
                    callback(Number(position));
                } catch (error) {
                    console.debug(`[NowBar] Could not read position: ${error.message}`);
                    callback(0);
                }
            }
        );
    }

    playPause() {
        const selected = this._selectCurrentPlayer();
        if (!selected || !getProperty(selected.proxy, 'CanControl', false))
            return;

        const status = getProperty(selected.proxy, 'PlaybackStatus', 'Stopped');
        if (status === 'Playing' && getProperty(selected.proxy, 'CanPause', false))
            this._call(selected.proxy, 'Pause');
        else if (status !== 'Playing' && getProperty(selected.proxy, 'CanPlay', false))
            this._call(selected.proxy, 'Play');
    }

    next() {
        const selected = this._selectCurrentPlayer();
        if (!selected)
            return;

        if (getProperty(selected.proxy, 'CanControl', false) &&
            getProperty(selected.proxy, 'CanGoNext', false))
            this._call(selected.proxy, 'Next');
    }

    previous() {
        const selected = this._selectCurrentPlayer();
        if (!selected)
            return;

        if (getProperty(selected.proxy, 'CanControl', false) &&
            getProperty(selected.proxy, 'CanGoPrevious', false))
            this._call(selected.proxy, 'Previous');
    }

    setPosition(trackId, position) {
        const selected = this._selectCurrentPlayer();
        if (!selected || !getProperty(selected.proxy, 'CanSeek', false))
            return;

        const metadata = getProperty(selected.proxy, 'Metadata', {});
        if ((metadata['mpris:trackid'] ?? '') !== trackId)
            return;

        selected.proxy.call(
            'SetPosition',
            new GLib.Variant('(ox)', [trackId, Math.round(position)]),
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (proxy, result) => {
                try {
                    proxy.call_finish(result);
                } catch (error) {
                    console.warn(`[NowBar] SetPosition failed: ${error.message}`);
                }
            }
        );
    }

    _watchBus() {
        this._nameOwnerChangedId = Gio.DBus.session.signal_subscribe(
            'org.freedesktop.DBus',
            'org.freedesktop.DBus',
            'NameOwnerChanged',
            '/org/freedesktop/DBus',
            null,
            Gio.DBusSignalFlags.NONE,
            (_connection, _sender, _path, _interface, _signal, parameters) => {
                const [name, _oldOwner, newOwner] = parameters.recursiveUnpack();
                if (!name.startsWith(MPRIS_PREFIX))
                    return;

                if (newOwner)
                    this._addPlayer(name);
                else
                    this._removePlayer(name);
            }
        );
    }

    _discoverPlayers() {
        try {
            const result = Gio.DBus.session.call_sync(
                'org.freedesktop.DBus',
                '/org/freedesktop/DBus',
                'org.freedesktop.DBus',
                'ListNames',
                null,
                new GLib.VariantType('(as)'),
                Gio.DBusCallFlags.NONE,
                -1,
                null
            );
            const [names] = result.recursiveUnpack();
            for (const name of names) {
                if (name.startsWith(MPRIS_PREFIX))
                    this._addPlayer(name);
            }
        } catch (error) {
            console.error(`[NowBar] Could not list D-Bus names: ${error.message}`);
        }
    }

    _addPlayer(name) {
        if (this._players.has(name))
            return;

        try {
            const proxy = Gio.DBusProxy.new_sync(
                Gio.DBus.session,
                Gio.DBusProxyFlags.NONE,
                null,
                name,
                MPRIS_PATH,
                PLAYER_IFACE,
                null
            );
            const propertiesChangedId = proxy.connect('g-properties-changed', () => {
                if (getProperty(proxy, 'PlaybackStatus', 'Stopped') === 'Playing')
                    this._lastActiveName = name;
                this._changed();
            });

            this._players.set(name, {proxy, propertiesChangedId});
            if (getProperty(proxy, 'PlaybackStatus', 'Stopped') === 'Playing')
                this._lastActiveName = name;
            this._changed();
        } catch (error) {
            console.debug(`[NowBar] Could not add ${name}: ${error.message}`);
        }
    }

    _removePlayer(name) {
        const player = this._players.get(name);
        if (!player)
            return;

        player.proxy.disconnect(player.propertiesChangedId);
        this._players.delete(name);
        if (this._lastActiveName === name)
            this._lastActiveName = null;
        this._changed();
    }

    _selectCurrentPlayer() {
        for (const [name, player] of this._players) {
            if (getProperty(player.proxy, 'PlaybackStatus', 'Stopped') === 'Playing') {
                this._lastActiveName = name;
                return {name, proxy: player.proxy};
            }
        }

        if (this._lastActiveName) {
            const player = this._players.get(this._lastActiveName);
            if (player && getProperty(player.proxy, 'PlaybackStatus', 'Stopped') === 'Paused')
                return {name: this._lastActiveName, proxy: player.proxy};
        }

        for (const [name, player] of this._players) {
            if (getProperty(player.proxy, 'PlaybackStatus', 'Stopped') === 'Paused')
                return {name, proxy: player.proxy};
        }

        return null;
    }

    _call(proxy, method) {
        proxy.call(method, null, Gio.DBusCallFlags.NONE, -1, null, (source, result) => {
            try {
                source.call_finish(result);
            } catch (error) {
                console.warn(`[NowBar] ${method} failed: ${error.message}`);
            }
        });
    }

    _changed() {
        this._onChanged();
    }

    destroy() {
        if (this._nameOwnerChangedId) {
            Gio.DBus.session.signal_unsubscribe(this._nameOwnerChangedId);
            this._nameOwnerChangedId = 0;
        }

        for (const player of this._players.values())
            player.proxy.disconnect(player.propertiesChangedId);

        this._players.clear();
        this._lastActiveName = null;
        this._onChanged = null;
    }
}
