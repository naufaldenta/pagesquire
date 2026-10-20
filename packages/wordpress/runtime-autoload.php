<?php

declare(strict_types=1);

/** Only the bundled, namespace-isolated runtime is loaded; the host does not need Composer. */
spl_autoload_register(static function (string $class): void {
    $prefixes = [
        'PageSquireWPVendor\\PageSquire\\Server\\' => __DIR__.'/pagesquire/src/',
        'PageSquireWPVendor\\Opis\\JsonSchema\\' => __DIR__.'/opis/json-schema/src/',
        'PageSquireWPVendor\\Opis\\String\\' => __DIR__.'/opis/string/src/',
        'PageSquireWPVendor\\Opis\\Uri\\' => __DIR__.'/opis/uri/src/',
    ];
    foreach ($prefixes as $prefix => $directory) {
        if (str_starts_with($class, $prefix)) {
            $file = $directory.str_replace('\\', '/', substr($class, strlen($prefix))).'.php';
            if (is_file($file)) {
                require $file;
            }

            return;
        }
    }
});
