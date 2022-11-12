const {optimize} = require('webpack');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const deepMerge = require('deepmerge');

// plugins
const CopyPlugin = require("copy-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const AssetsPlugin = require('assets-webpack-plugin');
const {CleanWebpackPlugin} = require('clean-webpack-plugin');
// const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;

const ROOT_CONTEXT = './';
const COMMON = '_common';

// активные проекты
const ALL_PROJECTS_LIST_JSON = ROOT_CONTEXT + 'deploy/projects.json';

// build config path
const COMMON_BUILD_CONFIG_FILE_PATH = ROOT_CONTEXT + 'app/config/buildconfig.json'

// манглинг исключения по префиксу класса
const MANGLE_EXCLUDE_PREFIX = [];
const MANGLE_EXCLUDE_END = [];

// babel version сверить с package json
const BABEL_VERSION = '2.6';

// bundle template
const DEFAULT_BUNDLE_TEMPLATE = 'bundle-[contenthash]';

let globalEnv, globalArgv;

// чтение файлов формата JSON
let readJSONFile = (path, fallbackObj) => {
    try {
        return JSON.parse(fs.readFileSync(path));
    } catch (e) {
        if (!!fallbackObj) return fallbackObj;

        console.error('Ошибка: Файл ' + e.path + ' не найден');
        return process.exit();
    }
}

let getProjectConfig = (prjName) => {

    let config = {};

    const IS_DEV = !globalEnv.production;
    const IS_SERVER = !!globalEnv.WEBPACK_SERVE;

    let configFile = deepMerge(
        readJSONFile(path.resolve(__dirname, COMMON_BUILD_CONFIG_FILE_PATH)),
        readJSONFile(path.resolve(__dirname, ROOT_CONTEXT + 'projects/' + prjName + '/app/config/buildconfig.json'), {})
    )

    const MANGLE_CLASS = configFile.cssClassNamesMangle;
    const IS_MANGLING = !!MANGLE_CLASS && !IS_DEV;
    let mangleClassNamesMap = {};

    let manglingFn = (name) => name;

    if (IS_MANGLING) {

        switch (MANGLE_CLASS) {

            case 'idx': {
                manglingFn = () => MANGLE_CLASS + Object.keys(mangleClassNamesMap).length.toString(36);
                break;
            }

            case 'md5': {
                manglingFn = (name, ctx) => {
                    let data = (name.concat(ctx)).slice(0, 6);
                    return MANGLE_CLASS + crypto.createHash('md5').update(data).digest('hex');
                };
                break;
            }

        }

    }

    config.name = prjName;

    config.mode = IS_DEV ? 'development' : 'production';
    config.devtool = IS_DEV ? 'eval-cheap-source-map' : 'source-map';

    config.entry = [
        'whatwg-fetch', // fetch polyfill
        ROOT_CONTEXT + 'projects/' + prjName + '/public/dev/root.js'
    ];

    // let bundleTemplate = configFile.bundleNameTemplate || DEFAULT_BUNDLE_TEMPLATE;
    let bundleTemplate = DEFAULT_BUNDLE_TEMPLATE;

    config.output = {
        filename: bundleTemplate + '.js',
        chunkFilename: '[id]-[chunkhash].js',
        path: path.resolve(__dirname, ROOT_CONTEXT + 'projects/' + prjName + '/public/build'),
        assetModuleFilename: 'assets/[contenthash][ext][query]',
        clean: true
    }

    config.stats = {
        errorDetails: true
    }

    if (IS_SERVER) {

        config.output.publicPath = '/build/'

        config.devServer = {
            hot: false,
            watchFiles: [`projects/${COMMON}/**/*.volt`, `projects/${prjName}/**/*.volt`],
            proxy: {
                '/': {
                    target: `http://${prjName}.local:8081/`,
                    changeOrigin: true,
                    secure: false
                },
            }
        };
    }

    config.resolve = {
        modules: [
            path.resolve(__dirname, ROOT_CONTEXT + 'projects/' + prjName + '/public/dev'),
            path.resolve(__dirname, ROOT_CONTEXT + 'projects/' + prjName + '/public'), // fallback
            path.resolve(__dirname, ROOT_CONTEXT + 'projects/' + COMMON),
            path.resolve(__dirname, 'node_modules')
        ],
        alias: {
            "_common": path.resolve(__dirname, ROOT_CONTEXT + 'projects/' + COMMON),
            "/img": [
                path.resolve(__dirname, ROOT_CONTEXT + 'projects/' + prjName + '/public/dev/img'),
                path.resolve(__dirname, ROOT_CONTEXT + 'projects/' + COMMON + '/img')
            ],
        }
    }

    let cssLoaderModules = {
        getLocalIdent: (context, localIdentName, localName) => {

            if (mangleClassNamesMap[localName]) {
                return mangleClassNamesMap[localName];
            }

            let exclude = false;

            if (!exclude) {
                exclude = !!MANGLE_EXCLUDE_PREFIX.find((element) => {
                    return localName.startsWith(element)
                })
            }

            if (!exclude) {
                exclude = !!MANGLE_EXCLUDE_END.find((element) => {
                    return localName.endsWith(element)
                })
            }

            if (!exclude) {
                return mangleClassNamesMap[localName] = manglingFn(localName, prjName);
            }

            mangleClassNamesMap[localName] = localName;

            return mangleClassNamesMap[localName];
        }
    }

    config.module = {
        rules: [
            {
                test: /\.m?js$/,
                exclude: /node_modules/,
                use: {
                    loader: "babel-loader",
                    options: {
                        presets: [['@babel/preset-env', {
                            useBuiltIns: 'usage',
                            corejs: BABEL_VERSION,
                            // debug: true,
                        }]],
                        plugins: [
                            "@babel/plugin-transform-runtime"
                        ],
                        cacheDirectory: true
                    }
                }
            },
            {
                test: /\.css$/,
                use: [
                    {
                        loader: MiniCssExtractPlugin.loader,
                        options: {
                            esModule: false
                        }
                    },
                    {
                        loader: "css-loader",
                    }
                ]
            },
            {
                test: /\.styl$/,
                use: [
                    {
                        loader: MiniCssExtractPlugin.loader,
                        options: {
                            esModule: false
                        }
                    },
                    {
                        loader: "css-loader",
                        options: {
                            modules: cssLoaderModules,
                        }
                    },
                    {
                        loader: 'stylus-loader',
                        options: {
                            stylusOptions: {
                                resolveURL: false,
                                define: {
                                    ...configFile.globalConstants,
                                    IS_DEV: IS_DEV,
                                },
                            }
                        }
                    }
                ]
            },
            {
                test: /\.(png|jpeg|jpg|svg|woff|woff2|eot|ttf)$/,
                type: 'asset'
            },
            {
                test: /\.htm$/,
                use: 'handlebars-loader'
            },
        ]
    }

    config.plugins = [
        // new BundleAnalyzerPlugin(),
        new CleanWebpackPlugin({
            cleanOnceBeforeBuildPatterns: [
                path.resolve(__dirname, 'projects/' + prjName + '/public/src/common/**/*')
            ]
        }),

        new optimize.MinChunkSizePlugin({
            minChunkSize: 50 * 1000, // Minimum number of characters
        }),
        new MiniCssExtractPlugin({
            filename: bundleTemplate + ".css",
        }),
        // корректирует prjName - при сборке нескольких проектов
        {
            apply: (compiler) => {
                compiler.options.name = prjName;
            }
        },
        new AssetsPlugin(
            {
                fullPath: false,
                filename: ROOT_CONTEXT + 'projects/' + prjName + '/public/build.php',
                update: true,
                processOutput: function (assets) {

                    if (!assets.main) console.log(prjName, assets);

                    return (
                        "<?php return new \\Phalcon\\Config([\n\n" +
                        "   'build' => [\n" +
                        "       'css'=> '" + assets.main.css + "',\n" +
                        "       'js' => '" + assets.main.js + "'\n" +
                        "   ]\n" +
                        "]);"
                    );

                }
            }
        ),
        // содаем мапу манглинга для бэка
        {
            apply: (compiler) => {

                compiler.hooks.afterEmit.tap('WriteCSSClassesMap', () => {

                    let path = ROOT_CONTEXT + 'projects/' + prjName + '/public/cssmap.php';
                    let onErr = (err) => {
                        err && console.error(err);
                    }

                    let manglingMapString = Object.keys(mangleClassNamesMap).map(item => {
                        return "           '" + item + "' => '" + mangleClassNamesMap[item] + "',\n";
                    }).join('') || '';

                    let data = (
                        '<?php return new \\Phalcon\\Config([\n' +
                        "   'css_mangle' => [\n" +
                        "       'enabled' => true,\n" +
                        "       'map' => [\n" +
                        manglingMapString +
                        "       ]\n" +
                        "   ]\n" +
                        "]);"
                    );

                    mangleClassNamesMap = {};

                    fs.writeFile(path, data, onErr);
                });

            }
        },
        new CopyPlugin({
            patterns: [
                {
                    from: path.resolve(__dirname, ROOT_CONTEXT + 'projects/' + COMMON + '/src'),
                    to: path.resolve(__dirname, ROOT_CONTEXT + 'projects/' + prjName + '/public/src/common'),
                    noErrorOnMissing: true
                }
            ],

        })
    ]

    return config

};

module.exports = (env, argv) => {

    globalEnv = env;
    globalArgv = argv;

    const prjName = argv.name;

    const ALL_PROJECTS = readJSONFile(path.resolve(__dirname, ALL_PROJECTS_LIST_JSON));

    let projects;

    if (prjName === 'all') {
        projects = ALL_PROJECTS;
    } else {
        projects = prjName.split(',').map(prjNameItem => prjNameItem.trim());

        projects.forEach(prjItem => {

            if (!ALL_PROJECTS.includes(prjItem)) {
                console.error('Ошибка: Проект "' + prjItem + '" не найден в файле ' + ALL_PROJECTS_LIST_JSON);
                return process.exit();
            }
        })
    }

    return projects.map(getProjectConfig);
};