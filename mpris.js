import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
const MPRIS_PATH = '/org/mpris/MediaPlayer2';

const PLAYER_IFACE =
    'org.mpris.MediaPlayer2.Player';

const PROPERTIES_IFACE =
    'org.freedesktop.DBus.Properties';


function getProperty(proxy, name, fallback = null) {
    const value =
        proxy.get_cached_property(name);

    if (value === null)
        return fallback;

    return value.recursiveUnpack();
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
        const selected =
            this._selectCurrentPlayer();

        if (!selected)
            return null;

        const {
            name,
            proxy,
        } = selected;


        const status = getProperty(
            proxy,
            'PlaybackStatus',
            'Stopped'
        );


        const metadata = getProperty(
            proxy,
            'Metadata',
            {}
        );


        const title =
            metadata['xesam:title'] ?? '';


        const album =
            metadata['xesam:album'] ?? '';


        const artUrl =
            metadata['mpris:artUrl'] ?? '';


        const trackId =
            metadata['mpris:trackid'] ?? '';


        const length = Number(
            metadata['mpris:length'] ?? 0
        );


        const artists =
            metadata['xesam:artist'] ?? [];


        let artist = '';

        if (Array.isArray(artists))
            artist = artists.join(', ');
        else if (typeof artists === 'string')
            artist = artists;


        const canSeek = getProperty(
            proxy,
            'CanSeek',
            false
        );


        return {
            name,

            status,

            title,
            artist,
            album,

            artUrl,

            trackId,
            length,

            canSeek,
        };
    }


    /*
     * Position нельзя нормально получать
     * через cached property:
     *
     * MPRIS не обязан отправлять
     * PropertiesChanged для Position.
     *
     * Поэтому запрашиваем его отдельно.
     */
    getPosition(callback) {
        const selected =
            this._selectCurrentPlayer();

        if (!selected) {
            callback?.(0);
            return;
        }


        const {name} = selected;


        Gio.DBus.session.call(
            name,

            MPRIS_PATH,

            PROPERTIES_IFACE,

            'Get',

            new GLib.Variant(
                '(ss)',
                [
                    PLAYER_IFACE,
                    'Position',
                ]
            ),

            new GLib.VariantType('(v)'),

            Gio.DBusCallFlags.NONE,

            -1,

            null,

            (connection, result) => {
                try {
                    const reply =
                        connection.call_finish(
                            result
                        );


                    const [position] =
                        reply.recursiveUnpack();


                    callback?.(
                        Number(position)
                    );

                } catch (error) {
                    console.debug(
                        `[My Media] Position error: ${error.message}`
                    );

                    callback?.(0);
                }
            }
        );
    }


    playPause() {
        const selected =
            this._selectCurrentPlayer();

        if (!selected)
            return;


        const {proxy} = selected;


        if (
            !getProperty(
                proxy,
                'CanControl',
                false
            )
        ) {
            return;
        }


        const status = getProperty(
            proxy,
            'PlaybackStatus',
            'Stopped'
        );


        if (status === 'Playing') {
            if (
                getProperty(
                    proxy,
                    'CanPause',
                    false
                )
            ) {
                this._call(
                    proxy,
                    'Pause'
                );
            }
        } else {
            if (
                getProperty(
                    proxy,
                    'CanPlay',
                    false
                )
            ) {
                this._call(
                    proxy,
                    'Play'
                );
            }
        }
    }


    next() {
        const selected =
            this._selectCurrentPlayer();

        if (!selected)
            return;


        const {proxy} = selected;


        if (
            getProperty(
                proxy,
                'CanControl',
                false
            ) &&
            getProperty(
                proxy,
                'CanGoNext',
                false
            )
        ) {
            this._call(
                proxy,
                'Next'
            );
        }
    }


    previous() {
        const selected =
            this._selectCurrentPlayer();

        if (!selected)
            return;


        const {proxy} = selected;


        if (
            getProperty(
                proxy,
                'CanControl',
                false
            ) &&
            getProperty(
                proxy,
                'CanGoPrevious',
                false
            )
        ) {
            this._call(
                proxy,
                'Previous'
            );
        }
    }


    _watchBus() {
        this._nameOwnerChangedId =
            Gio.DBus.session.signal_subscribe(
                'org.freedesktop.DBus',

                'org.freedesktop.DBus',

                'NameOwnerChanged',

                '/org/freedesktop/DBus',

                null,

                Gio.DBusSignalFlags.NONE,

                (
                    _connection,
                    _sender,
                    _path,
                    _interface,
                    _signal,
                    parameters
                ) => {
                    const [
                        name,
                        _oldOwner,
                        newOwner,
                    ] =
                        parameters.recursiveUnpack();


                    if (
                        !name.startsWith(
                            MPRIS_PREFIX
                        )
                    ) {
                        return;
                    }


                    if (newOwner)
                        this._addPlayer(name);
                    else
                        this._removePlayer(name);
                }
            );
    }


    _discoverPlayers() {
        try {
            const result =
                Gio.DBus.session.call_sync(
                    'org.freedesktop.DBus',

                    '/org/freedesktop/DBus',

                    'org.freedesktop.DBus',

                    'ListNames',

                    null,

                    new GLib.VariantType(
                        '(as)'
                    ),

                    Gio.DBusCallFlags.NONE,

                    -1,

                    null
                );


            const [names] =
                result.recursiveUnpack();


            for (const name of names) {
                if (
                    name.startsWith(
                        MPRIS_PREFIX
                    )
                ) {
                    this._addPlayer(name);
                }
            }

        } catch (error) {
            console.error(
                `[My Media] Failed to list D-Bus names: ${error.message}`
            );
        }
    }


    _addPlayer(name) {
        if (this._players.has(name))
            return;


        try {
            const proxy =
                Gio.DBusProxy.new_sync(
                    Gio.DBus.session,

                    Gio.DBusProxyFlags.NONE,

                    null,

                    name,

                    MPRIS_PATH,

                    PLAYER_IFACE,

                    null
                );


            const propertiesChangedId =
                proxy.connect(
                    'g-properties-changed',

                    () => {
                        const status =
                            getProperty(
                                proxy,

                                'PlaybackStatus',

                                'Stopped'
                            );


                        if (
                            status ===
                            'Playing'
                        ) {
                            this._lastActiveName =
                                name;
                        }


                        this._changed();
                    }
                );


            this._players.set(
                name,
                {
                    proxy,
                    propertiesChangedId,
                }
            );


            if (
                getProperty(
                    proxy,

                    'PlaybackStatus',

                    'Stopped'
                ) === 'Playing'
            ) {
                this._lastActiveName =
                    name;
            }


            this._changed();

        } catch (error) {
            console.debug(
                `[My Media] Failed to add ${name}: ${error.message}`
            );
        }
    }


    _removePlayer(name) {
        const player =
            this._players.get(name);

        if (!player)
            return;


        if (
            player.propertiesChangedId
        ) {
            player.proxy.disconnect(
                player.propertiesChangedId
            );
        }


        this._players.delete(name);


        if (
            this._lastActiveName ===
            name
        ) {
            this._lastActiveName =
                null;
        }


        this._changed();
    }


    _selectCurrentPlayer() {
        /*
         * Сначала Playing.
         */
        for (
            const [name, player]
            of this._players
        ) {
            const status =
                getProperty(
                    player.proxy,

                    'PlaybackStatus',

                    'Stopped'
                );


            if (status === 'Playing') {
                this._lastActiveName =
                    name;


                return {
                    name,
                    proxy: player.proxy,
                };
            }
        }


        /*
         * Последний активный Paused.
         */
        if (this._lastActiveName) {
            const player =
                this._players.get(
                    this._lastActiveName
                );


            if (
                player &&
                getProperty(
                    player.proxy,

                    'PlaybackStatus',

                    'Stopped'
                ) === 'Paused'
            ) {
                return {
                    name:
                        this._lastActiveName,

                    proxy:
                        player.proxy,
                };
            }
        }


        /*
         * Любой Paused.
         */
        for (
            const [name, player]
            of this._players
        ) {
            const status =
                getProperty(
                    player.proxy,

                    'PlaybackStatus',

                    'Stopped'
                );


            if (status === 'Paused') {
                return {
                    name,
                    proxy:
                        player.proxy,
                };
            }
        }


        return null;
    }


    _call(proxy, method) {
        proxy.call(
            method,

            null,

            Gio.DBusCallFlags.NONE,

            -1,

            null,

            (source, result) => {
                try {
                    source.call_finish(
                        result
                    );

                } catch (error) {
                    console.warn(
                        `[My Media] ${method} failed: ${error.message}`
                    );
                }
            }
        );
    }


    _changed() {
        this._onChanged?.();
    }


    destroy() {
        if (
            this._nameOwnerChangedId
        ) {
            Gio.DBus.session
                .signal_unsubscribe(
                    this
                        ._nameOwnerChangedId
                );


            this._nameOwnerChangedId =
                0;
        }


        for (
            const player
            of this._players.values()
        ) {
            if (
                player
                    .propertiesChangedId
            ) {
                player.proxy.disconnect(
                    player
                        .propertiesChangedId
                );
            }
        }


        this._players.clear();

        this._lastActiveName = null;

        this._onChanged = null;
    }
}
