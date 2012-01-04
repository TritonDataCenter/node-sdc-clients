all:


TEST_TIMEOUT=15000
test:
	./node_modules/.bin/whiskey --timeout $(TEST_TIMEOUT) --concurrency 1 --tests "`find tst | grep test.js | xargs`" --quiet
testverbose:
	./node_modules/.bin/whiskey --timeout $(TEST_TIMEOUT) --concurrency 1 --tests "`find tst | grep test.js | xargs`" --real-time
testamon:
	./node_modules/.bin/whiskey --timeout $(TEST_TIMEOUT) --concurrency 1 --tests tst/amon.test.js  --quiet --real-time
testmapi:
	NO_PROVISION_TESTS=1 \
               MAPI_ZONE_NAME=`sdc-mapi /zones/mapi | json -H name` \
               MAPI_ZONE_ALIAS=mapi \
               ./node_modules/.bin/whiskey --timeout $(TEST_TIMEOUT) \
               --concurrency 1 --tests tst/mapi.test.js  --quiet --real-time \
               --failfast
